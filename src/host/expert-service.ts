import { randomUUID } from "node:crypto";
import { mkdir, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { defineTool, type ToolExecution } from "@deepseek-ai/dsh-tools";
import type { ExpertRecord, ResolvedExpertSettings } from "../types.js";
import type { AnyReviewRun, ReviewRequest, TeamRun, TeamStageKind } from "../expert-types.js";
import { expertAiHome } from "./identity.js";
import { importMimeograph, loadExpertCatalog, loadExpertPackage, readExpertReference, recordForPackage, resolveRevision } from "./expert-packages.js";
import { listReviewRuns, readAnyReviewRun, readTeamRun, renderReviewMarkdown, saveReviewRun, validateReviewRequest } from "./review.js";
import { amendBrief, createTeamRun, expireIfIdle, isTerminal, nextStages, recoverInterrupted, TeamRunError, type NextStage } from "./team-run.js";
import { executeTeamStage, resolveTeamMembers, runExpertReview, type TeamInvocation, type TeamLineup } from "./team-exec.js";
import { renderTeamRunMarkdown } from "./team-render.js";

/** Branch used when the client does not name one. */
const DEFAULT_REF = "main";

/** Tool a structured stage subagent calls to submit its report (dsh-subagent in-process driver). */
const STRUCTURED_OUTPUT_TOOL = "structured_output";

interface Options {
  current: () => ResolvedExpertSettings;
  stateDir: () => string | undefined;
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("expert-ai: expected an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`expert-ai: ${label} is required`);
  return value;
}

const STAGES: readonly TeamStageKind[] = ["brief", "analysis", "cross-critique", "review", "synthesis"];
const MAX_OPEN_RUNS = 2;

function describeNext(next: readonly NextStage[]): string {
  return next.length === 0 ? "nextStages: none" : `nextStages: ${next.map((s) => `${s.stage}${s.memberIds === undefined ? "" : `(${s.memberIds.join(",")})`} — ${s.reason}`).join("; ")}`;
}

/** Serialize run admission across Host instances sharing one state directory. */
async function withCapacityLock<T>(stateDir: string | undefined, work: () => Promise<T>): Promise<T> {
  const directory = join(expertAiHome(process.env, stateDir), ".expert-reviews");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, ".capacity.lock");
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      handle = await open(path, "wx", 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        // A crashed Host must not permanently prevent new runs.
        if (Date.now() - (await stat(path)).mtimeMs > 30_000) await rm(path, { force: true });
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (handle === undefined) throw new Error("expert-ai: timed out waiting for the team-run capacity lock");
  const heartbeat = setInterval(() => { void handle?.utimes(new Date(), new Date()).catch(() => {}); }, 5_000);
  try {
    return await work();
  } finally {
    clearInterval(heartbeat);
    await handle.close();
    await rm(path, { force: true });
  }
}

/** Surface state-machine refusals with the stages the main agent can run instead. */
function explain(error: unknown): never {
  if (error instanceof TeamRunError) throw new Error(`${error.message}. ${describeNext(error.nextStages)}`);
  throw error;
}

function lineupOf(args: { teamId?: string; analystIds?: string[]; reviewerId?: string; coordinatorId?: string; responsibilities?: unknown }): TeamLineup {
  if (args.teamId !== undefined) {
    if (args.analystIds !== undefined || args.reviewerId !== undefined) throw new Error("expert-ai: pass either teamId or analystIds/reviewerId, not both");
    return { teamId: args.teamId };
  }
  if (args.analystIds === undefined || args.reviewerId === undefined) throw new Error("expert-ai: pass teamId or analystIds and reviewerId");
  const responsibilities = args.responsibilities;
  if (responsibilities !== undefined && (typeof responsibilities !== "object" || responsibilities === null || Array.isArray(responsibilities) ||
      Object.values(responsibilities).some((value) => typeof value !== "string" || value.trim() === "" || value.length > 200)))
    throw new Error("expert-ai: responsibilities must map member ids to 1-200 characters");
  return {
    analystIds: args.analystIds, reviewerId: args.reviewerId,
    ...(args.coordinatorId === undefined ? {} : { coordinatorId: args.coordinatorId }),
    ...(responsibilities === undefined ? {} : { responsibilities: responsibilities as Record<string, string> }),
  };
}

export function createExpertService(options: Options) {
  const recordFor = (id: string): ExpertRecord => {
    const record = options.current().records.find((item) => item.id === id && item.enabled);
    if (record === undefined) throw new Error(`expert-ai: enabled expert not found: ${id}`);
    return record;
  };
  // runId → controller for explicit cancellation of the stage currently executing.
  const active = new Map<string, { controller: AbortController; stop: AbortController; home: string }>();
  // Session ids of live stage subagents. Agent Teams installs its tools into a child's own
  // scope before the subagent descriptor exists, so `toolFilter` cannot hide them; a Host
  // guard denies them at execution instead.
  const stageChildren = new Set<string>();
  /** Bring a stored run up to date: recover Host stops, lazily expire idle runs, keep v1 legacy rules. */
  const refresh = async (run: AnyReviewRun, stateDir?: string): Promise<AnyReviewRun> => {
    if (active.has(run.id)) return run;
    let changed = false;
    if (run.schemaVersion === 1) {
      if (run.status === "running") {
        run.status = "failed";
        run.error = "Host stopped before this review finished. Start a new review to retry.";
        for (const step of run.steps) if (step.status === "running" || step.status === "pending") step.status = "cancelled";
        changed = true;
      }
    } else changed = recoverInterrupted(run) || expireIfIdle(run);
    if (changed) { run.updatedAt = new Date().toISOString(); await saveReviewRun(run, stateDir); }
    return run;
  };
  const owned = async (runId: string, exec: ToolExecution): Promise<TeamRun> => {
    const stateDir = options.stateDir();
    const run = await refresh(await readTeamRun(runId, stateDir), stateDir) as TeamRun;
    if (exec.agent?.id !== run.sessionId)
      throw new Error(`expert-ai: only the session that started this team run can change it. ${describeNext(nextStages(run))}`);
    return run;
  };
  const ensureCapacity = async (stateDir?: string): Promise<void> => {
    const open: TeamRun[] = [];
    for (const summary of await listReviewRuns(stateDir)) {
      if (summary.schemaVersion !== 2 || isTerminal(summary.status as TeamRun["status"])) continue;
      const run = await refresh(await readAnyReviewRun(summary.id, stateDir), stateDir);
      if (run.schemaVersion === 2 && !isTerminal(run.status)) open.push(run);
    }
    if (open.length >= MAX_OPEN_RUNS)
      throw new Error(`expert-ai: ${MAX_OPEN_RUNS} team runs are unfinished; continue or cancel one first: ${open.map((run) => `${run.id} (${run.status}): ${run.briefs[0]!.text.slice(0, 60)}`).join("; ")}`);
  };
  /**
   * Build the stage invoker for a session.
   * @param host Plugin context that injects `subagents`; session agent contexts do not.
   * @param parent Session agent the stage subagents belong to.
   */
  const invokerFor = (host: Agent["ctx"], parent: Agent) => {
    const settings = options.current();
    const provider = host.subagents.getProvider(settings.provider);
    if (!provider?.capabilities.persona || !provider.capabilities.toolFilter)
      throw new Error("expert-ai: review provider must support persona and toolFilter");
    return async ({ member, kind, prompt, signal, outputSchema }: TeamInvocation): Promise<unknown> => {
      signal.throwIfAborted();
      const child = await host.subagents.start(settings.provider, {
        label: `${kind}: ${member.name}`,
        parent,
        signal,
        persona: member.identity,
        prompt: [{ type: "text", text: prompt }],
        // Evidence is supplied by the Host; stages cannot recursively delegate or take external actions.
        toolFilter: { allow: [] },
        ...(provider.capabilities.agentOptions ? { agentOptions: { ...member.model, maxTokens: 4096 } }
          : member.model === undefined ? {} : { agentOptions: member.model }),
        ...(provider.capabilities.outputSchema ? { outputSchema } : {}),
      });
      // Tool calls need a model response first, so recording the id after `start()` is in time.
      stageChildren.add(child.id);
      try {
        const result = await child.result;
        if (result.stopReason !== "completed") throw new Error(`Review stage ended with ${result.stopReason}`);
        if (result.structured !== undefined) return result.structured;
        const text = result.output.filter((block) => block.type === "text").map((block) => block.text).join("").trim();
        return JSON.parse(text);
      } finally {
        stageChildren.delete(child.id);
        await child.dispose();
      }
    };
  };
  /** Run `work` while holding the run's lock and exposing an explicit-cancel controller. */
  const holding = async <T,>(runId: string, work: (cancel: AbortSignal, stop: AbortSignal) => Promise<T>): Promise<T> => {
    if (active.has(runId)) throw new Error("expert-ai: another stage of this run is still running");
    const controller = new AbortController();
    const stop = new AbortController();
    active.set(runId, { controller, stop, home: expertAiHome(process.env, options.stateDir()) });
    try { return await work(controller.signal, stop.signal); } finally { active.delete(runId); }
  };
  // Plain object literals so the `json` output schema (JsonValue) accepts them.
  const nextJson = (run: TeamRun) => nextStages(run).map((s) => ({ stage: s.stage, reason: s.reason, ...(s.memberIds === undefined ? {} : { memberIds: s.memberIds }) }));
  const result = (run: TeamRun) => ({ runId: run.id, status: run.status, nextStages: nextJson(run), markdown: renderTeamRunMarkdown(run) });

  const review = async (host: Agent["ctx"], request: ReviewRequest, exec: ToolExecution): Promise<TeamRun> => {
    const parent = exec.agent;
    if (parent === undefined) throw new Error("expert-ai: review requires an agent-backed session");
    const settings = options.current();
    validateReviewRequest(request, settings.records);
    const invoke = invokerFor(host, parent);
    const stateDir = options.stateDir();
    const controller = new AbortController();
    const stop = new AbortController();
    let runId: string | undefined;
    try {
      return await withCapacityLock(stateDir, async () => {
        await ensureCapacity(stateDir);
        return runExpertReview({
          request, records: settings.records, teams: settings.teams, sessionId: parent.id, invoke,
          signal: AbortSignal.any([exec.signal, stop.signal]),
          cancel: controller.signal,
          ...(stateDir === undefined ? {} : { stateDir }),
          persistStart: (run) => saveReviewRun(run, stateDir),
          onStart(id) { runId = id; active.set(id, { controller, stop, home: expertAiHome(process.env, stateDir) }); },
        });
      });
    } finally {
      if (runId !== undefined) active.delete(runId);
    }
  };

  return {
    dispose() {
      // Host shutdown is a tool-call abort: leave runs recoverable instead of terminally cancelled.
      for (const job of active.values()) job.stop.abort(new Error("Expert service stopped"));
    },
    guardStages(target: Pick<Agent, "ctx">): () => void {
      return target.ctx.tools.guard((exec) => exec.agent !== undefined && stageChildren.has(exec.agent.id) && exec.name !== STRUCTURED_OUTPUT_TOOL
        ? `expert-ai: team stage subagents may only call ${STRUCTURED_OUTPUT_TOOL}; ${exec.name} is not available`
        : undefined);
    },
    registerTools(target: Pick<Agent, "ctx">): () => void {
      const runOutput = {
        schema: { type: "object", additionalProperties: false, properties: {
          runId: { type: "string", required: true }, status: { type: "string", required: true },
          nextStages: { type: "json", required: true }, markdown: { type: "string", required: true },
        } },
        render: (_args: unknown, value: { markdown: string }) => [{ type: "text" as const, text: value.markdown }],
      } as const;
      const ORDER = "推荐顺序：brief（可选）→ 若有补问先交给用户，回答后 amend_team_brief → analysis → cross-critique（分析专家≥2时建议）→ review → synthesis。如实转述 synthesis 报告，你自己的补充单独标明。";
      const disposers = [
        target.ctx.tools.register(defineTool({
          name: "read_expert_reference",
          description: "读取已导入专家包中的参考资料。省略 path 列出文件；只返回本地固定版本内容，不会访问资料中的外部链接。",
          parameters: {
            id: { type: "string", required: true, description: "已启用的专家 ID" },
            path: { type: "string", description: "如 references/frameworks.md；省略则列出可读文件" },
          },
          output: { schema: { type: "json" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value, null, 2) }] },
          async execute(args) {
            const record = recordFor(args.id);
            if (record.expertPackage === undefined) throw new Error("expert-ai: expert has no imported package");
            const stateDir = options.stateDir();
            if (args.path === undefined) {
              const manifest = await loadExpertPackage(record.expertPackage, stateDir);
              return { id: record.id, revision: manifest.revision, files: manifest.files.filter((file) => file.path.startsWith("references/")) };
            }
            return { ...await readExpertReference(record, args.path, stateDir) };
          },
        })),
        target.ctx.tools.register(defineTool({
          name: "review_expert_plan",
          description: "固定顺序的方案评审快捷方式：1-3 位专家独立分析，审查者审查并汇总（start → analysis → review → synthesis，最多五次子代理调用）。需要补问、交叉批评或重试时改用 start_team_run。",
          parameters: {
            question: { type: "string", required: true, description: "完整方案、目标、资料和约束；最多20000字符" },
            expertIds: { type: "array", required: true, items: { type: "string" }, description: "1-3 位已启用分析专家 ID" },
            reviewerId: { type: "string", required: true, description: "与分析专家不同的审查专家 ID" },
          },
          output: {
            schema: { type: "object", additionalProperties: false, properties: { id: { type: "string", required: true }, status: { type: "string", required: true }, markdown: { type: "string", required: true } } },
            render: (_args, value) => [{ type: "text", text: value.markdown }],
          },
          async execute(args, exec) {
            const run = await review(target.ctx, args, exec);
            return { id: run.id, status: run.status, markdown: renderTeamRunMarkdown(run) };
          },
        })),
        target.ctx.tools.register(defineTool({
          name: "read_expert_review",
          description: "读取已保存的专家评审报告；可查看完整阶段与失败原因。",
          parameters: { id: { type: "string", required: true, description: "review- 开头的评审 ID" } },
          output: {
            schema: { type: "object", additionalProperties: false, properties: { id: { type: "string", required: true }, status: { type: "string", required: true }, markdown: { type: "string", required: true } } },
            render: (_args, value) => [{ type: "text", text: value.markdown }],
          },
          async execute(args) {
            const stateDir = options.stateDir();
            const run = await refresh(await readAnyReviewRun(args.id, stateDir), stateDir);
            return { id: run.id, status: run.status, markdown: run.schemaVersion === 1 ? renderReviewMarkdown(run) : renderTeamRunMarkdown(run) };
          },
        })),
        target.ctx.tools.register(defineTool({
          name: "start_team_run",
          description: `创建一次专家团运行（不调用子代理）。传 teamId 使用已保存的团队，或传 analystIds + reviewerId（可选 coordinatorId、responsibilities）组建临时阵容。${ORDER}`,
          parameters: {
            brief: { type: "string", required: true, description: "完整方案、目标、资料和约束；最多20000字符" },
            teamId: { type: "string", description: "已保存的团队 ID；与 analystIds/reviewerId 二选一" },
            analystIds: { type: "array", items: { type: "string" }, description: "1-3 位已启用分析专家 ID" },
            reviewerId: { type: "string", description: "与分析专家不同的审查专家 ID" },
            coordinatorId: { type: "string", description: "协调者 ID；省略时由审查者兼任" },
            responsibilities: { type: "json", description: "成员 ID → 职责（1-200 字符）" },
          },
          output: runOutput,
          async execute(args, exec) {
            const parent = exec.agent;
            if (parent === undefined) throw new Error("expert-ai: team runs require an agent-backed session");
            if (args.brief.trim() === "" || args.brief.length > 20_000) throw new Error("expert-ai: brief must be 1-20000 characters");
            const settings = options.current();
            const stateDir = options.stateDir();
            invokerFor(target.ctx, parent);
            return await withCapacityLock(stateDir, async () => {
              await ensureCapacity(stateDir);
              const lineup = lineupOf(args);
              if (!("teamId" in lineup) && lineup.responsibilities !== undefined) {
                const members = new Set([...lineup.analystIds, lineup.reviewerId, lineup.coordinatorId ?? lineup.reviewerId]);
                if (Object.keys(lineup.responsibilities).some((id) => !members.has(id)))
                  throw new Error("expert-ai: responsibilities must name members of this lineup");
              }
              const resolved = await resolveTeamMembers(lineup, args.brief, settings.records, settings.teams, stateDir);
              const run = createTeamRun({ id: `review-${randomUUID()}`, sessionId: parent.id, brief: args.brief, ...resolved });
              await saveReviewRun(run, stateDir);
              return { ...result(run), markdown: `${renderTeamRunMarkdown(run)}\n成员：${run.members.map((m) => `${m.id}（${m.roles.join("/")}：${m.responsibility}）`).join("，")}` };
            });
          },
        })),
        target.ctx.tools.register(defineTool({
          name: "amend_team_brief",
          description: "为团队运行追加一个简报版本，例如用户对补问的回答。第一个 analysis 开始后会被拒绝。",
          parameters: {
            runId: { type: "string", required: true, description: "start_team_run 返回的运行 ID" },
            text: { type: "string", required: true, description: "追加的简报内容" },
          },
          output: {
            schema: { type: "object", additionalProperties: false, properties: { briefVersion: { type: "number", required: true }, nextStages: { type: "json", required: true } } },
            render: (_args, value) => [{ type: "text", text: `brief@${value.briefVersion}` }],
          },
          async execute(args, exec) {
            const run = await owned(args.runId, exec);
            if (active.has(run.id)) throw new Error(`expert-ai: another stage of this run is still running. ${describeNext([])}`);
            try { amendBrief(run, args.text); } catch (error) { explain(error); }
            run.updatedAt = new Date().toISOString();
            await saveReviewRun(run, options.stateDir());
            return { briefVersion: run.briefs.at(-1)!.version, nextStages: nextJson(run) };
          },
        })),
        target.ctx.tools.register(defineTool({
          name: "run_team_stage",
          description: `执行团队运行的一个阶段并返回该阶段报告与 nextStages。memberIds 仅用于 analysis 和 cross-critique（例如只重试失败的分析专家）。前置条件不满足时报错并列出可执行阶段。${ORDER}`,
          parameters: {
            runId: { type: "string", required: true, description: "start_team_run 返回的运行 ID" },
            stage: { type: "string", enum: STAGES, required: true, description: "brief、analysis、cross-critique、review 或 synthesis" },
            memberIds: { type: "array", items: { type: "string" }, description: "本次运行的分析专家 ID 子集" },
          },
          output: runOutput,
          async execute(args, exec) {
            const run = await owned(args.runId, exec);
            const invoke = invokerFor(target.ctx, exec.agent!);
            const stateDir = options.stateDir();
            await holding(run.id, (cancel, stop) => executeTeamStage({
              run, kind: args.stage as TeamStageKind, invoke, signal: AbortSignal.any([exec.signal, stop]), cancel,
              ...(args.memberIds === undefined ? {} : { memberIds: args.memberIds }),
              ...(stateDir === undefined ? {} : { stateDir }),
            })).catch(explain);
            return result(run);
          },
        })),
        target.ctx.tools.register(defineTool({
          name: "read_team_run",
          description: "读取团队运行的状态、nextStages 与完整 Markdown 报告。任何会话都可读取。",
          parameters: { runId: { type: "string", required: true, description: "review- 开头的运行 ID" } },
          output: runOutput,
          async execute(args) {
            const stateDir = options.stateDir();
            return result(await refresh(await readTeamRun(args.runId, stateDir), stateDir) as TeamRun);
          },
        })),
        target.ctx.tools.register(defineTool({
          name: "cancel_team_run",
          description: "取消团队运行。正在执行的阶段标记为 cancelled，已完成的报告保留。",
          parameters: { runId: { type: "string", required: true, description: "要取消的运行 ID" } },
          output: runOutput,
          async execute(args, exec) {
            const run = await owned(args.runId, exec);
            const job = active.get(run.id);
            if (job !== undefined) {
              // The executing stage observes the abort, marks itself cancelled and saves the run.
              job.controller.abort(new Error("Team run cancelled"));
              return { runId: run.id, status: "cancelled", nextStages: [], markdown: "已请求取消；正在执行的阶段会标记为 cancelled。" };
            }
            if (isTerminal(run.status)) throw new Error(`expert-ai: team run ${run.id} is finished (${run.status}). ${describeNext([])}`);
            run.status = "cancelled";
            run.updatedAt = new Date().toISOString();
            await saveReviewRun(run, options.stateDir());
            return result(run);
          },
        })),
      ];
      return () => { for (const dispose of disposers) dispose(); };
    },
    async rpc(endpoint: string, payload: unknown) {
      try {
        const input = object(payload);
        const stateDir = options.stateDir();
        let value: unknown;
        if (endpoint === "expert/catalog") {
          // Branches and tags move; the catalog is read from the commit the ref points to right now.
          const ref = input.ref === undefined ? DEFAULT_REF : string(input.ref, "ref").trim();
          const home = expertAiHome(process.env, stateDir);
          const { revision, cached } = await resolveRevision(ref, fetch, home);
          value = { ref, cached, experts: await loadExpertCatalog(revision, fetch, home) };
        } else if (endpoint === "expert/import") {
          const ref = input.ref === undefined ? DEFAULT_REF : string(input.ref, "ref").trim();
          const { revision } = await resolveRevision(ref, fetch, expertAiHome(process.env, stateDir));
          const manifest = await importMimeograph({ source: "mimeographs", slug: string(input.slug, "slug"), revision }, stateDir);
          value = { manifest, record: recordForPackage(manifest, ref) };
        } else if (endpoint === "review/list") {
          const summaries = await listReviewRuns(stateDir);
          for (const summary of summaries) {
            const pending = summary.schemaVersion === 1 ? summary.status === "running" : !isTerminal(summary.status as TeamRun["status"]);
            if (pending && !active.has(summary.id)) {
              const run = await refresh(await readAnyReviewRun(summary.id, stateDir), stateDir);
              summary.status = run.status;
              summary.updatedAt = run.updatedAt;
            }
          }
          value = summaries;
        } else if (endpoint === "review/read") {
          const run = await refresh(await readAnyReviewRun(string(input.id, "id"), stateDir), stateDir);
          value = { run, markdown: run.schemaVersion === 1 ? renderReviewMarkdown(run) : renderTeamRunMarkdown(run) };
        } else if (endpoint === "review/cancel") {
          const id = string(input.id, "id");
          const job = active.get(id);
          if (job !== undefined) {
            if (job.home !== expertAiHome(process.env, stateDir)) throw new Error("expert-ai: review is not running");
            job.controller.abort(new Error("Review cancelled by user"));
          } else {
            const run = await refresh(await readAnyReviewRun(id, stateDir), stateDir);
            if (run.schemaVersion !== 2 || isTerminal(run.status)) throw new Error("expert-ai: review is not running");
            run.status = "cancelled";
            run.updatedAt = new Date().toISOString();
            await saveReviewRun(run, stateDir);
          }
          value = { cancelled: true };
        } else throw new Error(`expert-ai: unknown expert endpoint ${endpoint}`);
        return { ok: true as const, value };
      } catch (error) {
        return { ok: false as const, error: { code: "internal" as const, message: error instanceof Error ? error.message : String(error), details: {} } };
      }
    },
  };
}
