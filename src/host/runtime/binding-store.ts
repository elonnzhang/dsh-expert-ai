/**
 * A bound Session's plan, saved under `<data>/sessions/<sessionId>.json` so a Host restart
 * mounts the same prompt and policy. Bindings saved by earlier versions are read as plans;
 * their prompt text is kept exactly as it was saved.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expertAiHome } from "../identity/index.js";
import { PLAN_VERSION, type ExpertPlan } from "./plan.js";
import { sectionsFromParts } from "./prompts.js";

/** Bindings saved after the prompt was split into sections, before plans. */
interface SplitBinding {
  recordId: string;
  pre: string;
  persona: string;
  suf: string;
}

/** Bindings saved before the prompt was split kept it as one text. */
interface PromptBinding {
  recordId: string;
  prompt: string;
}

export interface LoadedBinding {
  plan: ExpertPlan;
  /** The file holds an older format; saving the plan upgrades it. */
  legacy: boolean;
}

function bindingPath(sessionId: string, stateDir?: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(sessionId))
    throw new Error(`expert-ai: invalid session id "${sessionId}"`);
  return join(expertAiHome(process.env, stateDir), "sessions", `${sessionId}.json`);
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

function isPlan(value: Record<string, unknown>): value is ExpertPlan & Record<string, unknown> {
  return value.version === PLAN_VERSION && isString(value.expertId) && isString(value.revision) &&
    Array.isArray(value.sections) &&
    value.sections.every((section) => isObject(section) && isString(section.name) && typeof section.order === "number" && isString(section.text)) &&
    isObject(value.policy) && value.policy.sandbox === "read-only" &&
    (value.policy.tools === undefined || (Array.isArray(value.policy.tools) && value.policy.tools.every(isString)));
}

function legacyPlan(recordId: string, parts: SplitBinding): ExpertPlan {
  // An old binding saved no policy; it keeps the behavior it had: read-only, every tool.
  return { version: PLAN_VERSION, expertId: recordId, revision: "", sections: sectionsFromParts(parts), policy: { sandbox: "read-only" } };
}

export async function loadBinding(sessionId: string, stateDir?: string): Promise<LoadedBinding | undefined> {
  let content: string;
  try {
    content = await readFile(bindingPath(sessionId, stateDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(content);
  const invalid = new Error(`expert-ai: invalid binding for session "${sessionId}"`);
  if (!isObject(value)) throw invalid;
  // Expert teams are gone; a session one hosted names no expert and opens unbound.
  if ("team" in value) return undefined;
  if (isPlan(value)) return { plan: value, legacy: false };
  if (!isString(value.recordId)) throw invalid;
  if (isString(value.pre) && isString(value.persona) && isString(value.suf))
    return { plan: legacyPlan(value.recordId, value as unknown as SplitBinding), legacy: true };
  if (isString(value.prompt)) {
    const { recordId, prompt } = value as unknown as PromptBinding;
    return { plan: legacyPlan(recordId, { recordId, pre: prompt, persona: "", suf: "" }), legacy: true };
  }
  throw invalid;
}

export async function saveBinding(sessionId: string, plan: ExpertPlan, stateDir?: string): Promise<void> {
  const path = bindingPath(sessionId, stateDir);
  await mkdir(join(expertAiHome(process.env, stateDir), "sessions"), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(plan), { flag: "wx", mode: 0o600 });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function deleteBinding(sessionId: string, stateDir?: string): Promise<void> {
  try {
    await unlink(bindingPath(sessionId, stateDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
