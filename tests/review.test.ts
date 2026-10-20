import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import type { ExpertRecord } from "../src/types.js";
import type { ReviewReport, ReviewRun, SynthesisReport, TeamRun } from "../src/expert-types.js";
import { listReviewRuns, parseReviewReport, readAnyReviewRun, readReviewRun, renderReviewMarkdown, REVIEW_OUTPUT_SCHEMA, saveReviewRun } from "../src/host/review.js";
import { runExpertReview, type RunReviewOptions, type TeamInvocation } from "../src/host/team-exec.js";
import { importMimeograph, recordForPackage } from "../src/host/expert-packages.js";
import { createTeamRun } from "../src/host/team-run.js";
import { runExpertReview as publicRunExpertReview, runExpertTeamReview as publicRunExpertTeamReview, readReviewRun as publicReadReviewRun } from "../src/index.js";
import { packageBinding, packageFetcher } from "./expert-fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const records: ExpertRecord[] = ["alpha", "beta", "critic"].map((id) => ({
  id, name: id, description: "Check evidence", category: "science", tags: [], persona: `Methods of ${id}`, enabled: true,
}));
function report(summary = "Check the baseline", evidenceIds = ["input:brief@1"]): ReviewReport {
  return { summary, findings: [{ claim: "The brief needs a baseline", kind: "observation", evidenceIds }], assumptions: ["No external experiment was run"], disagreements: [], nextActions: ["Define a measurable baseline"] };
}
function synthesis(missingStages: string[] = []): SynthesisReport {
  const { disagreements: _ignored, ...base } = report("Synthesis");
  return { ...base, disagreements: [], options: [], validationPlan: [{ task: "Run baseline", decides: "Whether drift matters", stopCondition: "Two weeks" }], missingStages };
}
function supplied(input: TeamInvocation) {
  return JSON.parse(input.prompt.split("\n\n").at(-1)!) as { evidence: Array<{ id: string }>; previousReports: Array<{ id: string }>; missingStages: string[] };
}
function answer(input: TeamInvocation): unknown {
  // The synthesizer echoes the missing stages the Host told it about.
  return input.kind === "synthesis" ? synthesis(supplied(input).missingStages) : report(`${input.kind} by ${input.member.id}`);
}
async function setup(): Promise<RunReviewOptions> {
  const stateDir = await mkdtemp(join(tmpdir(), "expert-review-test-"));
  roots.push(stateDir);
  return {
    stateDir, records, teams: [],
    request: { question: "Review this proposed experiment", expertIds: ["alpha", "beta"], reviewerId: "critic" },
    sessionId: "session-test",
    signal: new AbortController().signal,
    invoke: async (input) => answer(input),
  };
}
const legacy: ReviewRun = {
  schemaVersion: 1, id: "review-00000000-0000-0000-0000-0000000000aa", sessionId: "old", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  status: "completed", request: { question: "Legacy brief", expertIds: ["alpha"], reviewerId: "critic" }, experts: [], evidence: [],
  steps: [{ id: "analysis-1", role: "analyst", expertId: "alpha", status: "completed", report: { ...report(), findings: [{ claim: "Old", kind: "observation", evidenceIds: ["input:brief"] }] } }],
};

describe("fixed expert review shortcut (v2)", () => {
  it("runs analysis, review and synthesis as a v2 run within 5 calls", async () => {
    const options = await setup();
    const invoke = vi.fn(async (input: TeamInvocation) => answer(input));
    const run = await publicRunExpertTeamReview({ ...options, invoke });
    expect(invoke.mock.calls.map(([input]) => input.kind)).toEqual(["analysis", "analysis", "review", "synthesis"]);
    expect(run).toMatchObject({ schemaVersion: 2, status: "completed", budget: { maxCalls: 5, callsUsed: 4 } });
    expect(await readAnyReviewRun(run.id, options.stateDir)).toEqual(run);
    expect(await listReviewRuns(options.stateDir)).toMatchObject([{ id: run.id, status: "completed", schemaVersion: 2, question: "Review this proposed experiment" }]);
  });

  it("is partial when one analyst fails and lists the missing analysis", async () => {
    const options = await setup();
    const run = await runExpertReview({ ...options, invoke: async (input) => {
      if (input.member.id === "beta") throw new Error("provider unavailable");
      return answer(input);
    } });
    expect(run.status).toBe("partial");
    expect(run.stages.find((s) => s.id === "analysis-beta-1")).toMatchObject({ status: "failed", error: "provider unavailable" });
    expect((run.stages.at(-1)?.report as SynthesisReport).missingStages).toEqual(["analysis-beta"]);
  });

  it("fails without review when every analyst failed", async () => {
    const options = await setup();
    const invoke = vi.fn(async () => { throw new Error("no model"); });
    const run = await runExpertReview({ ...options, invoke });
    expect(run.status).toBe("failed");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("ends as cancelled, not open, when the tool call is aborted", async () => {
    const options = await setup();
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const running = runExpertReview({ ...options, signal: controller.signal, invoke: (input) => {
      started.resolve();
      return new Promise<unknown>((_resolve, reject) => input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true }));
    } });
    await started.promise;
    controller.abort(new Error("user stopped"));
    const run = await running;
    expect(run.status).toBe("cancelled");
    expect((await readAnyReviewRun(run.id, options.stateDir)).status).toBe("cancelled");
  });

  it("rejects duplicate, disabled, missing or overlapping members before invocation", async () => {
    const options = await setup();
    const invoke = vi.fn(async () => report());
    await expect(runExpertReview({ ...options, invoke, request: { ...options.request, expertIds: ["alpha", "alpha"] } })).rejects.toThrow(/different/);
    await expect(runExpertReview({ ...options, invoke, request: { ...options.request, reviewerId: "alpha" } })).rejects.toThrow(/separate/);
    await expect(runExpertReview({ ...options, invoke, records: records.map((item) => ({ ...item, enabled: false })) })).rejects.toThrow(/enabled/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("gives analysts only their own package evidence and restricts citations per stage", async () => {
    const options = await setup();
    const imported = recordForPackage(await importMimeograph(packageBinding, options.stateDir, packageFetcher()), "main");
    options.records = [imported, records[1]!, records[2]!];
    options.request.expertIds = [imported.id, "beta"];
    let methodId = "";
    const run = await runExpertReview({ ...options, invoke: async (input) => {
      const evidence = supplied(input).evidence;
      if (input.kind === "analysis" && input.member.id === imported.id) {
        expect(evidence).toHaveLength(3);
        methodId = evidence[0]!.id;
        return report("The method suggests a baseline", [methodId]);
      }
      if (input.kind === "analysis") {
        expect(evidence).toHaveLength(0);
        return report("Invented source", ["not-supplied"]);
      }
      expect(evidence.map((item) => item.id)).toContain(methodId);
      return answer(input);
    } });
    expect(run.status).toBe("partial");
    expect(run.evidence[0]?.text).toContain("Compare alternatives");
    expect(run.stages.find((s) => s.id === "analysis-beta-1")?.error).toContain("not supplied");
    expect(run.members[0]?.expertPackage).toEqual({ ...packageBinding, ref: "main" });
  });
});

describe("saved review records", () => {
  it("reads and lists v1 records next to v2 runs", async () => {
    const options = await setup();
    await saveReviewRun(legacy, options.stateDir);
    expect(await readReviewRun(legacy.id, options.stateDir)).toEqual(legacy);
    expect(await readAnyReviewRun(legacy.id, options.stateDir)).toEqual(legacy);
    expect(renderReviewMarkdown(legacy)).toContain("Legacy brief");
    const run = await runExpertReview(options);
    expect((await listReviewRuns(options.stateDir)).map((s) => [s.id, s.schemaVersion])).toEqual([[run.id, 2], [legacy.id, 1]]);
    await expect(readReviewRun(run.id, options.stateDir)).rejects.toThrow(/invalid saved review/);
  });

  it("rejects invented citations, unsupported output fields and unsupported observations", () => {
    expect(() => assertObjectJsonSchema(REVIEW_OUTPUT_SCHEMA)).not.toThrow();
    expect(() => parseReviewReport(report("Test", ["imaginary"]), new Set(["input:brief@1"]))).toThrow(/not supplied/);
    expect(() => parseReviewReport(report("Test", []), new Set())).toThrow(/require supplied evidence/);
    expect(() => parseReviewReport({ ...report(), extra: "unsupported" }, new Set(["input:brief@1"]))).toThrow(/schema/);
    expect(() => parseReviewReport(null, new Set())).toThrow(/object/);
  });

  it("keeps an older open run visible after 30 newer completed reviews", async () => {
    const { stateDir } = await setup();
    const open = createTeamRun({
      id: "review-00000000-0000-0000-0000-000000000001", sessionId: "old", brief: "Unfinished",
      members: [], evidence: [], now: "2025-01-01T00:00:00.000Z",
    });
    await saveReviewRun(open, stateDir);
    await Promise.all(Array.from({ length: 30 }, (_, index) => saveReviewRun({
      ...legacy,
      id: `review-${(index + 2).toString(16).padStart(36, "0")}`,
      createdAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    }, stateDir)));
    const summaries = await listReviewRuns(stateDir);
    expect(summaries).toHaveLength(31);
    expect(summaries.some((summary) => summary.id === open.id && summary.status === "open")).toBe(true);
  });

  it("keeps the exported fixed-review function compatible with its v1 caller", async () => {
    const options = await setup();
    const run = await publicRunExpertReview({
      request: options.request, records: options.records, sessionId: options.sessionId,
      signal: options.signal, stateDir: options.stateDir,
      invoke: async () => ({ ...report(), findings: [{ claim: "Brief", kind: "observation", evidenceIds: ["input:brief"] }] }),
    });
    expect(run.schemaVersion).toBe(1);
    expect(await publicReadReviewRun(run.id, options.stateDir)).toEqual(run);
  });

  it("rejects traversal and malformed v2 records", async () => {
    const { stateDir } = await setup();
    await expect(readAnyReviewRun("../settings", stateDir)).rejects.toThrow(/invalid review id/);
    await saveReviewRun({ ...legacy, schemaVersion: 2 } as unknown as TeamRun, stateDir);
    await expect(readAnyReviewRun(legacy.id, stateDir)).rejects.toThrow(/invalid saved review/);
  });
});
