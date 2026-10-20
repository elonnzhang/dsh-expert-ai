import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { SubagentStartRequest } from "@deepseek-ai/dsh-subagent";
import type { ExpertTeam, ReviewReport, SynthesisReport } from "../src/expert-types.js";
import type { ExpertRecord } from "../src/types.js";
import { createExpertService } from "../src/host/expert-service.js";
import { readAnyReviewRun, readTeamRun, saveReviewRun } from "../src/host/review.js";
import { packageBinding, packageFetcher } from "./expert-fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const report: ReviewReport = { summary: "Check evidence", findings: [], assumptions: ["Needs external validation"], disagreements: [], nextActions: ["Run a controlled comparison"] };
const synthesis: SynthesisReport = { summary: "Synthesis", findings: [], assumptions: [], nextActions: [], disagreements: [], options: [], validationPlan: [], missingStages: [] };
const records: ExpertRecord[] = ["analyst", "reviewer"].map((id) => ({ id, name: id, description: id, category: "science", tags: [], persona: `Method ${id}`, enabled: true }));
const request = { question: "Evaluate the study plan", expertIds: ["analyst"], reviewerId: "reviewer" };
type RegisteredTool = { name: string; execute: (args: unknown, exec: ToolExecution) => Promise<unknown> };

async function fixture(structured = true, teams: ExpertTeam[] = []) {
  const stateDir = await mkdtemp(join(tmpdir(), "expert-service-test-"));
  roots.push(stateDir);
  const registered = new Map<string, RegisteredTool>();
  const dispose = vi.fn(async () => {});
  const start = vi.fn(async (_provider: string, input: SubagentStartRequest) => {
    const value = input.label?.startsWith("synthesis") ? synthesis : report;
    return {
      id: "child",
      result: Promise.resolve({ stopReason: "completed", output: [{ type: "text", text: JSON.stringify(value) }], ...(structured ? { structured: value } : {}) }),
      dispose,
    };
  });
  const guards: Array<(exec: Partial<ToolExecution>) => string | undefined> = [];
  const parent = { id: "session-fixture", ctx: {
    subagents: { getProvider: () => ({ capabilities: { persona: true, toolFilter: true, outputSchema: structured, agentOptions: true } }), start },
    tools: {
      register: (tool: RegisteredTool) => { registered.set(tool.name, tool); return () => registered.delete(tool.name); },
      guard: (guard: (typeof guards)[number]) => { guards.push(guard); return () => guards.splice(guards.indexOf(guard), 1); },
    },
  } } as unknown as Agent;
  const service = createExpertService({ current: () => ({ provider: "spawn", maxBatchSize: 3, records, teams }), stateDir: () => stateDir });
  const unregister = service.registerTools(parent);
  const unguard = service.guardStages(parent);
  const signal = new AbortController().signal;
  const exec = { agent: parent, signal } as ToolExecution;
  return { stateDir, registered, guards, dispose, start, parent, service, exec, unregister, unguard };
}

describe("expert Host service", () => {
  it("lists and imports experts by branch, keeping the commit internal", async () => {
    const f = await fixture();
    const files = packageFetcher();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) =>
      String(input).startsWith("https://api.github.com/") ? new Response(packageBinding.revision) : files(input, init)));
    try {
      expect(await f.service.rpc("expert/catalog", { ref: " main " })).toMatchObject({
        ok: true, value: { ref: "main", cached: false, experts: [{ slug: "test-expert" }] },
      });
      const imported = await f.service.rpc("expert/import", { slug: "test-expert", ref: "main" });
      expect(imported).toMatchObject({ ok: true, value: { record: { expertPackage: { ...packageBinding, ref: "main" } } } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("registers real tool definitions and delegates isolated, structured stages", async () => {
    const f = await fixture();
    expect([...f.registered.keys()]).toEqual([
      "read_expert_reference", "review_expert_plan", "read_expert_review",
      "start_team_run", "amend_team_brief", "run_team_stage", "read_team_run", "cancel_team_run",
    ]);
    const result = await f.registered.get("review_expert_plan")!.execute(request, f.exec) as { id: string; status: string };
    expect(result.status).toBe("completed");
    expect(f.start).toHaveBeenCalledTimes(3);
    expect(f.dispose).toHaveBeenCalledTimes(3);
    for (const [provider, input] of f.start.mock.calls) {
      expect(provider).toBe("spawn");
      expect(input.toolFilter).toEqual({ allow: [] });
      expect(input.outputSchema?.type).toBe("object");
      expect(input.parent).toBe(f.parent);
      expect(input.persona).toMatch(/^Method/);
    }
    expect(await f.service.rpc("review/read", { id: result.id })).toMatchObject({ ok: true, value: { run: { status: "completed" } } });
    f.unregister();
    expect(f.registered.size).toBe(0);
  });

  it("validates JSON output when the provider has no outputSchema capability", async () => {
    const f = await fixture(false);
    const result = await f.registered.get("review_expert_plan")!.execute(request, f.exec) as { status: string };
    expect(result.status).toBe("completed");
    expect(f.start.mock.calls.every(([, input]) => input.outputSchema === undefined)).toBe(true);
  });

  it("stops an active run through RPC and keeps its cancellation record", async () => {
    const f = await fixture();
    const started = Promise.withResolvers<void>();
    f.start.mockImplementation(async (_provider, input) => {
      started.resolve();
      return {
        id: "waiting-child", dispose: f.dispose,
        result: new Promise((_resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true })),
      };
    });
    const running = f.registered.get("review_expert_plan")!.execute(request, f.exec);
    await started.promise;
    const listing = await f.service.rpc("review/list", {});
    const id = (listing.ok ? listing.value as Array<{ id: string }> : [])[0]!.id;
    expect(await f.service.rpc("review/cancel", { id })).toMatchObject({ ok: true });
    expect(await running).toMatchObject({ status: "cancelled" });
    expect((await readAnyReviewRun(id, f.stateDir)).status).toBe("cancelled");
    expect(f.start).toHaveBeenCalledTimes(1);
  });

  it("returns runs left running by a stopped Host to open with a failed stage", async () => {
    const f = await fixture();
    const result = await f.registered.get("review_expert_plan")!.execute(request, f.exec) as { id: string };
    const run = await readTeamRun(result.id, f.stateDir);
    run.status = "running";
    run.stages.at(-1)!.status = "running";
    await saveReviewRun(run, f.stateDir);
    const read = await f.service.rpc("review/read", { id: run.id });
    expect(read).toMatchObject({ ok: true, value: { run: { status: "open" } } });
    const saved = await readTeamRun(run.id, f.stateDir);
    expect(saved.stages[0]?.status).toBe("completed");
    expect(saved.stages.at(-1)).toMatchObject({ status: "failed", error: "Host 已停止" });
  });

  it("returns structured errors for malformed RPC payloads", async () => {
    const f = await fixture();
    expect(await f.service.rpc("review/read", null)).toMatchObject({ ok: false });
    expect(await f.service.rpc("review/read", { id: "../private" })).toMatchObject({ ok: false });
    expect(await f.service.rpc("expert/catalog", { ref: "../main" })).toMatchObject({ ok: false });
    expect(await f.service.rpc("expert/import", { slug: "test-expert", ref: "feature/" })).toMatchObject({ ok: false });
    expect(await f.service.rpc("review/cancel", { id: "missing" })).toMatchObject({ ok: false });
  });

  it("lets the owning session drive a team run stage by stage", async () => {
    const f = await fixture();
    const tool = (name: string) => f.registered.get(name)!;
    const started = await tool("start_team_run").execute({ brief: "Evaluate the study plan", analystIds: ["analyst"], reviewerId: "reviewer" }, f.exec) as { runId: string; nextStages: Array<{ stage: string }> };
    expect(started.nextStages.map((s) => s.stage)).toContain("analysis");
    expect(await tool("amend_team_brief").execute({ runId: started.runId, text: "Budget is two weeks" }, f.exec)).toMatchObject({ briefVersion: 2 });
    for (const stage of ["analysis", "review", "synthesis"])
      await tool("run_team_stage").execute({ runId: started.runId, stage }, f.exec);
    expect(await tool("read_team_run").execute({ runId: started.runId }, f.exec)).toMatchObject({ status: "completed", markdown: expect.stringContaining("input:brief@2") });
    expect(f.start).toHaveBeenCalledTimes(3);
    await expect(tool("run_team_stage").execute({ runId: started.runId, stage: "review" }, f.exec)).rejects.toThrow(/finished/);
  });

  it("rejects writes from another session, invalid stage order and a third open run", async () => {
    const f = await fixture();
    const tool = (name: string) => f.registered.get(name)!;
    const args = { brief: "Evaluate the study plan", analystIds: ["analyst"], reviewerId: "reviewer" };
    const { runId } = await tool("start_team_run").execute(args, f.exec) as { runId: string };
    const other = { ...f.exec, agent: { ...f.parent, id: "other-session" } } as ToolExecution;
    await expect(tool("run_team_stage").execute({ runId, stage: "analysis" }, other)).rejects.toThrow(/session/);
    await expect(tool("cancel_team_run").execute({ runId }, other)).rejects.toThrow(/session/);
    await expect(tool("read_team_run").execute({ runId }, other)).resolves.toMatchObject({ status: "open" });
    await expect(tool("run_team_stage").execute({ runId, stage: "synthesis" }, f.exec)).rejects.toThrow(/nextStages.*analysis/s);
    await tool("start_team_run").execute(args, f.exec);
    await expect(tool("start_team_run").execute(args, f.exec)).rejects.toThrow(new RegExp(`${runId}.*Evaluate the study plan`, "s"));
    expect(f.start).not.toHaveBeenCalled();
  });

  it("starts a saved team by id and cancels an open run from settings", async () => {
    const f = await fixture(true, [{ id: "study", name: "Study", purpose: "Plans", analystIds: ["analyst"], reviewerId: "reviewer" }]);
    const { runId } = await f.registered.get("start_team_run")!.execute({ brief: "Evaluate", teamId: "study" }, f.exec) as { runId: string };
    expect((await readTeamRun(runId, f.stateDir)).teamId).toBe("study");
    expect(await f.service.rpc("review/cancel", { id: runId })).toMatchObject({ ok: true });
    expect((await readTeamRun(runId, f.stateDir)).status).toBe("cancelled");
    expect(await f.service.rpc("review/read", { id: runId })).toMatchObject({ ok: true, value: { markdown: expect.stringContaining("cancelled") } });
  });

  it("starts stage subagents from the Host context, not the session agent context", async () => {
    const f = await fixture();
    // Session agent contexts do not inject `subagents`; cordis throws on access.
    const ctx = new Proxy({}, { get: (_target, prop) => { throw new Error(`cannot get property "${String(prop)}" without inject`); } });
    const exec = { ...f.exec, agent: { id: f.parent.id, ctx } } as unknown as ToolExecution;
    const { runId } = await f.registered.get("start_team_run")!.execute({ brief: "Evaluate", analystIds: ["analyst"], reviewerId: "reviewer" }, exec) as { runId: string };
    await f.registered.get("run_team_stage")!.execute({ runId, stage: "analysis" }, exec);
    expect(f.start).toHaveBeenCalledTimes(1);
    expect((await f.registered.get("review_expert_plan")!.execute(request, exec) as { status: string }).status).toBe("completed");
  });

  it("denies every tool but structured_output to a live stage subagent, even once the tools are withdrawn", async () => {
    const f = await fixture();
    const denied = (agentId: string, name: string) => f.guards.map((guard) => guard({ agent: { id: agentId } as Agent, name })).find((reason) => reason !== undefined);
    const seen: Array<string | undefined>[] = [];
    f.start.mockImplementation(async () => ({
      id: "stage-child", dispose: f.dispose,
      // A child can only call tools after a model response, i.e. after `start()` has resolved.
      result: new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
        seen.push([denied("stage-child", "spawn_teammate"), denied("stage-child", "structured_output"), denied("session-fixture", "spawn_teammate")]);
        f.unregister();
        seen.push([denied("stage-child", "spawn_teammate")]);
        return { stopReason: "completed", output: [], structured: report };
      }),
    }));
    const { runId } = await f.registered.get("start_team_run")!.execute({ brief: "Evaluate", analystIds: ["analyst"], reviewerId: "reviewer" }, f.exec) as { runId: string };
    await f.registered.get("run_team_stage")!.execute({ runId, stage: "analysis" }, f.exec);
    expect(seen).toEqual([[expect.stringMatching(/spawn_teammate/), undefined, undefined], [expect.stringMatching(/spawn_teammate/)]]);
    // The id is released with the run.
    expect(denied("stage-child", "spawn_teammate")).toBeUndefined();
    expect(f.guards).toHaveLength(1);
    f.unguard();
    expect(f.guards).toHaveLength(0);
  });
});
