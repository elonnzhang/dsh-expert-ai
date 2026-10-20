import type { ExpertReference, TeamMember, TeamMemberRole, TeamRun, TeamRunStatus, TeamStage, TeamStageKind, TeamStageReport } from "../expert-types.js";

export const DEFAULT_BUDGET = { maxCalls: 10, maxActiveMs: 600_000 } as const;
export const STAGE_TIMEOUT_MS = 180_000;
export const IDLE_EXPIRY_MS = 24 * 3_600_000;
const TERMINAL: ReadonlySet<TeamRunStatus> = new Set(["completed", "partial", "failed", "cancelled", "timed-out", "expired"]);
const PREFIX = { brief: "brief", analysis: "analysis", "cross-critique": "critique", review: "review", synthesis: "synthesis" } as const;

/** A stage the main agent may run next. */
export interface NextStage { stage: TeamStageKind; memberIds?: string[]; reason: string }
/** One subagent call planned for a stage, with exactly what it may see. */
export interface StageCall { id: string; kind: TeamStageKind; expertId: string; briefVersion: number; inputStageIds: string[]; evidenceIds: string[]; requiredMissing: string[] }
export type StageOutcome = { report: TeamStageReport } | { status: "failed" | "cancelled"; error: string };
export type ExecutionOutcome = "settled" | "cancelled" | "aborted" | "timed-out";

/** Rejection that costs no budget and tells the caller what can run instead. */
export class TeamRunError extends Error {
  readonly nextStages: NextStage[];
  constructor(message: string, nextStages: NextStage[]) { super(message); this.nextStages = nextStages; }
}

export function isTerminal(status: TeamRunStatus): boolean { return TERMINAL.has(status); }

export function createTeamRun(input: {
  id: string; sessionId: string; brief: string; members: TeamMember[]; evidence: ExpertReference[];
  teamId?: string; now?: string; budget?: { maxCalls: number; maxActiveMs: number };
}): TeamRun {
  const now = input.now ?? new Date().toISOString();
  return {
    schemaVersion: 2, id: input.id, sessionId: input.sessionId,
    ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    createdAt: now, updatedAt: now, status: "open",
    briefs: [{ version: 1, text: input.brief, source: "user", createdAt: now }],
    members: input.members, evidence: input.evidence, stages: [],
    budget: { ...(input.budget ?? DEFAULT_BUDGET), callsUsed: 0, activeMs: 0 },
  };
}

const withRole = (run: TeamRun, role: TeamMemberRole): string[] => run.members.filter((m) => m.roles.includes(role)).map((m) => m.id);
const briefVersion = (run: TeamRun): number => run.briefs.at(-1)?.version ?? 1;
const briefRef = (run: TeamRun): string => `input:brief@${briefVersion(run)}`;
function latest(run: TeamRun, kind: TeamStageKind, expertId?: string): TeamStage | undefined {
  return run.stages.findLast((s) => s.kind === kind && s.status === "completed" && (expertId === undefined || s.expertId === expertId));
}
const completedAnalysts = (run: TeamRun): string[] => withRole(run, "analyst").filter((id) => latest(run, "analysis", id) !== undefined);
const evidenceOf = (run: TeamRun, expertIds: readonly string[]): string[] =>
  run.evidence.filter((item) => expertIds.includes(item.expertId)).map((item) => item.id);
function critiqueInputs(run: TeamRun, expertId: string): string[] {
  return completedAnalysts(run).filter((id) => id !== expertId).map((id) => latest(run, "analysis", id)!.id);
}
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);
function reviewInputs(run: TeamRun): string[] {
  const brief = latest(run, "brief");
  const analyses = completedAnalysts(run).map((id) => latest(run, "analysis", id)!.id);
  // Critiques made before an analysis was retried are stale and no longer shown downstream.
  const critiques = withRole(run, "analyst").flatMap((id) => {
    const critique = latest(run, "cross-critique", id);
    return critique !== undefined && same(critique.inputStageIds, critiqueInputs(run, id)) ? [critique.id] : [];
  });
  return [...(brief === undefined ? [] : [brief.id]), ...analyses, ...critiques];
}
const missingAnalyses = (run: TeamRun): string[] =>
  withRole(run, "analyst").filter((id) => latest(run, "analysis", id) === undefined).map((id) => `analysis-${id}`);
function reviewFresh(run: TeamRun): boolean {
  const review = latest(run, "review");
  return review !== undefined && same(review.inputStageIds, reviewInputs(run));
}

/** Stages the main agent may run now; empty while running or after a terminal status. */
export function nextStages(run: TeamRun): NextStage[] {
  if (isTerminal(run.status) || run.status === "running") return [];
  const analysts = withRole(run, "analyst");
  const done = completedAnalysts(run);
  const next: NextStage[] = [];
  if (!run.stages.some((s) => s.kind === "analysis")) {
    next.push({ stage: "brief", reason: "可选：协调者拆解目标并提出补问" });
    next.push({ stage: "analysis", reason: "各位分析专家独立分析" });
  } else if (done.length < analysts.length) {
    next.push({ stage: "analysis", memberIds: analysts.filter((id) => !done.includes(id)), reason: "重试缺少成功分析的专家" });
  }
  const staleCritics = done.filter((id) => !same(latest(run, "cross-critique", id)?.inputStageIds ?? ["-"], critiqueInputs(run, id)));
  if (done.length >= 2 && staleCritics.length > 0)
    next.push({ stage: "cross-critique", memberIds: staleCritics, reason: "分析专家互相批评（建议）" });
  if (done.length > 0 && !reviewFresh(run))
    next.push({ stage: "review", reason: latest(run, "review") === undefined ? "审查已完成的分析" : "审查已过时，需要重新审查" });
  if (reviewFresh(run)) next.push({ stage: "synthesis", reason: "汇总并给出验证计划" });
  return next;
}

/** Validate a stage request and compute what each call may see. Throws {@link TeamRunError} without side effects. */
export function planStage(run: TeamRun, kind: TeamStageKind, memberIds?: readonly string[]): StageCall[] {
  const reject = (message: string): TeamRunError => new TeamRunError(`expert-ai: ${message}`, nextStages(run));
  if (isTerminal(run.status)) throw reject(`team run ${run.id} is finished (${run.status})`);
  if (run.status === "running") throw reject("another stage of this run is still running");
  const analysts = withRole(run, "analyst");
  if (memberIds !== undefined && kind !== "analysis" && kind !== "cross-critique")
    throw reject("memberIds only applies to analysis and cross-critique");
  if (memberIds !== undefined && (memberIds.length === 0 || memberIds.some((id) => !analysts.includes(id))))
    throw reject("memberIds must name analysts of this run");
  if (memberIds !== undefined && new Set(memberIds).size !== memberIds.length)
    throw reject("memberIds must be unique");
  const reviewer = withRole(run, "reviewer")[0]!;
  const call = (expertId: string, inputStageIds: string[], evidenceIds: string[], requiredMissing: string[] = []): StageCall => ({
    id: `${PREFIX[kind]}-${expertId}-${run.stages.filter((s) => s.kind === kind && s.expertId === expertId).length + 1}`,
    kind, expertId, briefVersion: briefVersion(run), inputStageIds, evidenceIds: [briefRef(run), ...evidenceIds], requiredMissing,
  });
  const all = run.evidence.map((item) => item.id);
  let calls: StageCall[];
  if (kind === "brief") {
    if (run.stages.some((s) => s.kind === "analysis")) throw reject("brief must run before analysis");
    calls = [call(withRole(run, "coordinator")[0] ?? reviewer, [], [])];
  } else if (kind === "analysis") {
    const brief = latest(run, "brief");
    calls = (memberIds ?? analysts).map((id) => call(id, brief === undefined ? [] : [brief.id], evidenceOf(run, [id])));
  } else if (kind === "cross-critique") {
    if (completedAnalysts(run).length < 2) throw reject("cross-critique needs at least 2 completed analyses");
    calls = (memberIds ?? completedAnalysts(run)).map((id) => {
      const inputs = critiqueInputs(run, id);
      return call(id, inputs, evidenceOf(run, run.stages.filter((s) => inputs.includes(s.id)).map((s) => s.expertId)));
    });
  } else if (kind === "review") {
    if (completedAnalysts(run).length === 0) throw reject("review needs at least 1 completed analysis");
    calls = [call(reviewer, reviewInputs(run), all)];
  } else {
    const review = latest(run, "review");
    if (review === undefined) throw reject("synthesis needs a completed review");
    if (!reviewFresh(run)) throw reject("the review is stale; run review again first");
    calls = [call(reviewer, [...reviewInputs(run), review.id], all, missingAnalyses(run))];
  }
  const left = run.budget.maxCalls - run.budget.callsUsed;
  if (calls.length > left) throw reject(`budget allows ${left} more calls; ${kind} needs ${calls.length}`);
  return calls;
}

/** Append a brief version (e.g. the user's answers to clarifying questions). */
export function amendBrief(run: TeamRun, text: string, now = new Date().toISOString()): void {
  if (isTerminal(run.status)) throw new TeamRunError(`expert-ai: team run ${run.id} is finished (${run.status})`, []);
  if (run.status === "running") throw new TeamRunError("expert-ai: another stage of this run is still running", []);
  if (run.stages.some((s) => s.kind === "analysis"))
    throw new TeamRunError("expert-ai: cannot amend the brief after analysis has started", nextStages(run));
  if (text.trim() === "" || text.length > 20_000) throw new TeamRunError("expert-ai: brief amendment must contain 1-20000 characters", nextStages(run));
  run.briefs.push({ version: briefVersion(run) + 1, text, source: "amendment", createdAt: now });
}

/** Record planned calls as running and spend their budget. */
export function beginStage(run: TeamRun, calls: readonly StageCall[], now = new Date().toISOString()): void {
  for (const c of calls)
    run.stages.push({ id: c.id, kind: c.kind, expertId: c.expertId, briefVersion: c.briefVersion, inputStageIds: c.inputStageIds, evidenceIds: c.evidenceIds, status: "running", startedAt: now });
  run.budget.callsUsed += calls.length;
  run.status = "running";
}

/** Store one call's report or failure. */
export function settleStage(run: TeamRun, stageId: string, outcome: StageOutcome, now = new Date().toISOString()): void {
  const stage = run.stages.find((s) => s.id === stageId);
  if (stage === undefined || stage.status !== "running") return;
  stage.finishedAt = now;
  if ("report" in outcome) { stage.status = "completed"; stage.report = outcome.report; }
  else { stage.status = outcome.status; stage.error = outcome.error; }
}

/** Close an execution: account active time, cancel leftovers and derive the run status. */
export function finishExecution(run: TeamRun, elapsedMs: number, outcome: ExecutionOutcome, now = new Date().toISOString()): void {
  run.budget.activeMs += elapsedMs;
  for (const stage of run.stages.filter((s) => s.status === "running")) {
    stage.status = "cancelled"; stage.finishedAt = now;
    stage.error = outcome === "timed-out" ? "运行超出时间预算" : outcome === "aborted" ? "工具调用已中止" : "已取消";
  }
  if (outcome === "cancelled" || outcome === "timed-out") { run.status = outcome; return; }
  const last = run.stages.at(-1);
  if (outcome === "settled" && last?.kind === "synthesis" && last.status === "completed") {
    // An optional stage counts as failed when its member's most recent attempt of that kind failed.
    const optionalFailed = run.stages.some((s) => (s.kind === "brief" || s.kind === "cross-critique")
      && run.stages.findLast((other) => other.kind === s.kind && other.expertId === s.expertId)?.status === "failed");
    run.status = missingAnalyses(run).length > 0 || optionalFailed ? "partial" : "completed";
    return;
  }
  if (run.budget.callsUsed >= run.budget.maxCalls) {
    run.status = "failed";
    run.error = "调用预算已用完，未完成汇总";
    return;
  }
  run.status = "open";
}

/** End a run that cannot continue, e.g. the fixed shortcut after every analyst failed. */
export function markFailed(run: TeamRun, error: string): void { run.status = "failed"; run.error = error; }

/** Lazily expire an open run idle for 24 hours, releasing its concurrency slot. */
export function expireIfIdle(run: TeamRun, now = Date.now()): boolean {
  if (run.status !== "open" || now - Date.parse(run.updatedAt) <= IDLE_EXPIRY_MS) return false;
  run.status = "expired";
  return true;
}

/** Fail stages left running by a Host that stopped; the run can be continued. */
export function recoverInterrupted(run: TeamRun, now = new Date().toISOString()): boolean {
  if (run.status !== "running") return false;
  for (const stage of run.stages.filter((s) => s.status === "running")) { stage.status = "failed"; stage.error = "Host 已停止"; stage.finishedAt = now; }
  run.status = "open";
  return true;
}
