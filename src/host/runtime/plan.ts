/**
 * The expert runtime compiles a record and its identity into an {@link ExpertPlan} once,
 * then mounts that same plan on whichever surface runs the expert: a bound Session for a
 * single-expert chat, or a subagent for `consult_expert`. One compiler means both entry
 * points share a prompt and a policy; a plan is plain data, so it is also the Session
 * binding saved to disk.
 */
import { createHash } from "node:crypto";
import type { CanonicalExpertRecord } from "../../types.js";
import { chatSections, consultationPrompt } from "./prompts.js";

export const PLAN_VERSION = 2;

/** One system prompt section the plan installs, in ascending `order`. */
export interface PlanSection {
  name: string;
  order: number;
  text: string;
}

/** What an expert may do wherever it runs. */
export interface ExpertPolicy {
  /** Expert surfaces never write files; changes are proposed to the user. */
  sandbox: "read-only";
  /** Global tools the expert keeps; absent keeps every tool the surface offers. */
  tools?: string[];
  /** Provider and model for a consultation. A chat follows the deployment model (see the design doc). */
  model?: { provider?: string; model?: string };
}

export interface ExpertPlan {
  version: typeof PLAN_VERSION;
  expertId: string;
  /** sha256 of the identity body, the same value `expertIdentity` publishes. */
  revision: string;
  sections: PlanSection[];
  policy: ExpertPolicy;
}

export function identityRevision(identity: string): string {
  return createHash("sha256").update(identity.trim(), "utf8").digest("hex");
}

export function policyFor(record: Pick<CanonicalExpertRecord, "toolFilter" | "model">): ExpertPolicy {
  const tools = record.toolFilter?.map((tool) => tool.trim()).filter(Boolean);
  const model = record.model === undefined
    ? undefined
    : Object.fromEntries(Object.entries(record.model).filter(([, value]) => typeof value === "string" && value.trim() !== ""));
  return {
    sandbox: "read-only",
    ...(tools === undefined || tools.length === 0 ? {} : { tools: [...new Set(tools)] }),
    ...(model === undefined || Object.keys(model).length === 0 ? {} : { model }),
  };
}

/** Compile the plan a single-expert chat mounts. */
export function compileChatPlan(record: CanonicalExpertRecord, identity: string): ExpertPlan {
  return {
    version: PLAN_VERSION,
    expertId: record.id,
    revision: identityRevision(identity),
    sections: chatSections(record, identity),
    policy: policyFor(record),
  };
}

/** What a consultation hands the subagent provider. */
export interface ConsultationPlan {
  expertId: string;
  revision: string;
  label: string;
  persona: string;
  prompt: string;
  policy: ExpertPolicy;
}

export function compileConsultationPlan(record: CanonicalExpertRecord, identity: string, question: string): ConsultationPlan {
  return {
    expertId: record.id,
    revision: identityRevision(identity),
    label: `专家：${record.name}`,
    persona: identity,
    prompt: consultationPrompt(record, question),
    policy: policyFor(record),
  };
}
