/** The subagent surface: runs a consultation plan once and returns the expert's answer. */
import type { Context } from "@deepseek-ai/cordis";
// Type-only: pulls the ctx.subagents service merge into this program.
import type { SubagentResult, SubagentRun } from "@deepseek-ai/dsh-subagent";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { ConsultationPlan } from "./plan.js";

/** Consultations always run on the Harness `spawn` provider; there is no setting for it. */
export const CONSULT_PROVIDER = "spawn";

function outputText(run: SubagentRun, result: SubagentResult): string {
  const text = result.output
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (text === "") throw new Error(`expert-ai: ${String(run.id)} returned no text`);
  return text;
}

export async function runConsultation(ctx: Context, plan: ConsultationPlan, exec: ToolExecution): Promise<string> {
  if (exec.agent === undefined) throw new Error("expert-ai consultation requires an agent-backed session");
  const provider = ctx.subagents.getProvider(CONSULT_PROVIDER);
  if (provider === undefined) throw new Error(`expert-ai: subagent provider "${CONSULT_PROVIDER}" is unavailable`);
  if (!provider.capabilities.persona) throw new Error(`expert-ai: provider "${CONSULT_PROVIDER}" does not support persona`);
  const { tools, model } = plan.policy;
  if (tools !== undefined && !provider.capabilities.toolFilter)
    throw new Error(`expert-ai: provider "${CONSULT_PROVIDER}" does not support toolFilter`);
  const run = await ctx.subagents.start(CONSULT_PROVIDER, {
    label: plan.label,
    prompt: [{ type: "text", text: plan.prompt }],
    parent: exec.agent,
    signal: exec.signal,
    persona: plan.persona,
    ...(tools === undefined ? {} : { toolFilter: { allow: tools } }),
    ...(model === undefined ? {} : { agentOptions: model }),
  });
  try {
    const result = await run.result;
    if (result.stopReason !== "completed")
      throw new Error(`expert-ai: consultation with "${plan.label.replace(/^专家：/, "")}" ended with ${result.stopReason}`);
    return outputText(run, result);
  } finally {
    await run.dispose();
  }
}
