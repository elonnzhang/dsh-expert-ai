import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expertAiHome } from "./identity.js";

export interface ExpertBinding {
  /** Bound expert. */
  recordId: string;
  /** Text before the identity. */
  pre: string;
  /** The identity file (AGENTS.md) verbatim. */
  persona: string;
  /** Text after the identity. */
  suf: string;
}

/** Bindings saved before the prompt was split kept it as one text. */
export interface LegacyExpertBinding {
  recordId: string;
  prompt: string;
}

/** Keep an old session's saved prompt intact when moving it to the split format. */
export function preserveLegacyBinding(binding: LegacyExpertBinding): ExpertBinding {
  return { recordId: binding.recordId, pre: binding.prompt, persona: "", suf: "" };
}

function bindingPath(sessionId: string, stateDir?: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(sessionId))
    throw new Error(`expert-ai: invalid session id "${sessionId}"`);
  return join(expertAiHome(process.env, stateDir), "sessions", `${sessionId}.json`);
}

function isBinding(value: object): value is ExpertBinding {
  const binding = value as ExpertBinding;
  return typeof binding.recordId === "string" &&
    typeof binding.pre === "string" && typeof binding.persona === "string" && typeof binding.suf === "string";
}

function isLegacyBinding(value: object): value is LegacyExpertBinding {
  const binding = value as LegacyExpertBinding;
  return typeof binding.recordId === "string" && typeof binding.prompt === "string";
}

export async function loadBinding(
  sessionId: string,
  stateDir?: string,
): Promise<ExpertBinding | LegacyExpertBinding | undefined> {
  let content: string;
  try {
    content = await readFile(bindingPath(sessionId, stateDir), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const value: unknown = JSON.parse(content);
  // Expert teams are gone; a session one hosted names no expert and opens unbound.
  if (typeof value === "object" && value !== null && "team" in value) return undefined;
  if (typeof value !== "object" || value === null || !(isBinding(value) || isLegacyBinding(value)))
    throw new Error(`expert-ai: invalid binding for session "${sessionId}"`);
  return value;
}

export async function saveBinding(sessionId: string, binding: ExpertBinding, stateDir?: string): Promise<void> {
  const path = bindingPath(sessionId, stateDir);
  await mkdir(join(expertAiHome(process.env, stateDir), "sessions"), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(binding), { flag: "wx", mode: 0o600 });
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
