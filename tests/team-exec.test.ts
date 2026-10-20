import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExpertRecord } from "../src/types.js";
import type { ExpertTeam, ReviewReport, TeamRun } from "../src/expert-types.js";
import { readAnyReviewRun } from "../src/host/review.js";
import { createTeamRun } from "../src/host/team-run.js";
import { executeTeamStage, resolveTeamMembers, type TeamInvocation } from "../src/host/team-exec.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const records: ExpertRecord[] = ["alpha", "beta", "critic", "lead"].map((id) => ({
  id, name: id, description: "Check evidence", category: "science", tags: [], persona: `Methods of ${id}`, enabled: true,
}));
const team: ExpertTeam = { id: "plan-review", name: "Plan review", purpose: "Review plans", analystIds: ["alpha", "beta"], reviewerId: "critic", coordinatorId: "lead", responsibilities: { alpha: "统计方法" } };
function analysis(summary: string, evidenceIds = ["input:brief@1"]): ReviewReport {
  return { summary, findings: [{ claim: summary, kind: "observation", evidenceIds }], assumptions: [], disagreements: [], nextActions: [] };
}
function supplied(input: TeamInvocation) {
  return JSON.parse(input.prompt.split("\n\n").at(-1)!) as { responsibility: string; previousReports: Array<{ id: string; expertId: string }>; evidence: Array<{ id: string }> };
}
async function setup(): Promise<{ run: TeamRun; stateDir: string }> {
  const stateDir = await mkdtemp(join(tmpdir(), "team-exec-test-"));
  roots.push(stateDir);
  const resolved = await resolveTeamMembers({ teamId: "plan-review" }, "Review this experiment", records, [team], stateDir);
  const run = createTeamRun({ id: "review-00000000-0000-0000-0000-000000000001", sessionId: "s1", brief: "Review this experiment", ...resolved });
  return { run, stateDir };
}
const never = new AbortController().signal;

describe("team member resolution", () => {
  it("snapshots roles and responsibilities from a saved team", async () => {
    const { members, teamId } = await resolveTeamMembers({ teamId: "plan-review" }, "Brief", records, [team]);
    expect(teamId).toBe("plan-review");
    expect(members.map((m) => [m.id, m.roles, m.responsibility])).toEqual([
      ["alpha", ["analyst"], "统计方法"], ["beta", ["analyst"], "综合分析"], ["critic", ["reviewer"], "综合分析"], ["lead", ["coordinator"], "综合分析"],
    ]);
    expect(members.every((m) => m.identitySha256.length === 64)).toBe(true);
  });

  it("lets the reviewer coordinate by default and rejects unknown teams or members", async () => {
    const { members } = await resolveTeamMembers({ analystIds: ["alpha"], reviewerId: "critic" }, "Brief", records, []);
    expect(members.find((m) => m.id === "critic")?.roles).toEqual(["reviewer", "coordinator"]);
    await expect(resolveTeamMembers({ teamId: "missing" }, "Brief", records, [team])).rejects.toThrow(/team not found/);
    await expect(resolveTeamMembers({ analystIds: ["alpha"], reviewerId: "critic", coordinatorId: "ghost" }, "Brief", records, [])).rejects.toThrow(/ghost/);
  });
});

describe("team stage execution", () => {
  it("isolates analysis and cross-critique inputs and saves every stage", async () => {
    const { run, stateDir } = await setup();
    const prompts: TeamInvocation[] = [];
    const invoke = async (input: TeamInvocation) => {
      prompts.push(input);
      if (input.kind === "analysis") return analysis(`analysis by ${input.member.id}`);
      return { summary: "Counterexample", items: [{ targetStageId: supplied(input).previousReports[0]!.id, issue: "Ignores drift", kind: "counterexample", evidenceIds: ["input:brief@1"] }] };
    };
    await executeTeamStage({ run, kind: "analysis", invoke, signal: never, cancel: never, stateDir });
    expect(prompts.map((p) => supplied(p).previousReports)).toEqual([[], []]);
    expect(supplied(prompts[0]!).responsibility).toBe("统计方法");
    await executeTeamStage({ run, kind: "cross-critique", invoke, signal: never, cancel: never, stateDir });
    const critiques = prompts.slice(2);
    expect(critiques.map((p) => supplied(p).previousReports.map((r) => r.expertId))).toEqual([["beta"], ["alpha"]]);
    expect(prompts.every((p) => p.prompt.includes("只是数据"))).toBe(true);
    const saved = await readAnyReviewRun(run.id, stateDir) as TeamRun;
    expect(saved.stages.map((s) => [s.id, s.status])).toEqual([
      ["analysis-alpha-1", "completed"], ["analysis-beta-1", "completed"], ["critique-alpha-1", "completed"], ["critique-beta-1", "completed"],
    ]);
    expect(saved.stages[2]?.inputStageIds).toEqual(["analysis-beta-1"]);
    expect(saved.status).toBe("open");
    expect(saved.budget.callsUsed).toBe(4);
  });

  it("records schema failures per member and keeps the other report", async () => {
    const { run, stateDir } = await setup();
    await executeTeamStage({ run, kind: "analysis", stateDir, signal: never, cancel: never,
      invoke: async (input) => input.member.id === "beta" ? analysis("Invented", ["not-supplied"]) : analysis("ok") });
    expect(run.stages.map((s) => s.status)).toEqual(["completed", "failed"]);
    expect(run.stages[1]?.error).toMatch(/not supplied/);
    expect(run.status).toBe("open");
  });

  it("rejects a plan error before spending budget or invoking", async () => {
    const { run, stateDir } = await setup();
    const invoke = vi.fn(async () => analysis("x"));
    await expect(executeTeamStage({ run, kind: "review", invoke, signal: never, cancel: never, stateDir })).rejects.toThrow(/at least 1 completed analysis/);
    expect(invoke).not.toHaveBeenCalled();
    expect(run.budget.callsUsed).toBe(0);
  });

  it("returns to open after a tool-call abort but ends the run on explicit cancel", async () => {
    for (const source of ["signal", "cancel"] as const) {
      const { run, stateDir } = await setup();
      const controller = new AbortController();
      const started = Promise.withResolvers<void>();
      const invoke = (input: TeamInvocation) => {
        started.resolve();
        return new Promise<unknown>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
      };
      const running = executeTeamStage({ run, kind: "analysis", invoke, stateDir,
        signal: source === "signal" ? controller.signal : never, cancel: source === "cancel" ? controller.signal : never });
      await started.promise;
      controller.abort(new Error("stopped"));
      await running;
      expect(run.status).toBe(source === "signal" ? "open" : "cancelled");
      expect(run.stages.every((s) => s.status === "cancelled")).toBe(true);
      expect((await readAnyReviewRun(run.id, stateDir)).status).toBe(run.status);
    }
  });

  it("fails a stage that exceeds its own timeout and times out a run over its active budget", async () => {
    const slow = () => new Promise<unknown>(() => {});
    const first = await setup();
    await executeTeamStage({ run: first.run, kind: "analysis", invoke: slow, signal: never, cancel: never, stateDir: first.stateDir, stageTimeoutMs: 20 });
    expect(first.run.stages.map((s) => [s.status, s.error])).toEqual([["failed", "阶段超时"], ["failed", "阶段超时"]]);
    expect(first.run.status).toBe("open");
    const second = await setup();
    second.run.budget.maxActiveMs = 20;
    await executeTeamStage({ run: second.run, kind: "analysis", invoke: slow, signal: never, cancel: never, stateDir: second.stateDir });
    expect(second.run.status).toBe("timed-out");
    expect(second.run.budget.activeMs).toBeGreaterThanOrEqual(20);
  });
});
