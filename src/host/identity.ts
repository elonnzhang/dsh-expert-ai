import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import type { DigitalLifeRecord } from "../types.js";
import { readPackageIdentity } from "./expert-packages.js";

const MAX_IDENTITY_BYTES = 1024 * 1024;

/** Resolve the per-digital-life storage root. */
export function digitalLifeHome(
  env: Record<string, string | undefined> = process.env,
  stateDir?: string,
): string {
  const configured = stateDir?.trim() || env.DSH_HOME?.trim();
  if (configured === undefined || configured === "")
    return join(homedir(), ".dsh", "digital-life");
  const expanded = configured === "~"
    ? homedir()
    : configured.startsWith("~/") || configured.startsWith("~\\")
      ? join(homedir(), configured.slice(2))
      : configured;
  const root = resolve(expanded);
  // `stateDir` is shown to users as the digital-life data directory. Older
  // configurations may already include the final `digital-life` segment, so
  // do not append it a second time.
  return root.endsWith(`${sep}digital-life`) ? root : join(root, "digital-life");
}

/** Create an empty working directory for a standalone Chat session. */
export async function createProject(stateDir?: string): Promise<string> {
  const projects = join(digitalLifeHome(process.env, stateDir), "projects");
  await mkdir(projects, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const name = suffix === 0 ? stamp : `${stamp}-${String(suffix)}`;
    const path = join(projects, name);
    try {
      await mkdir(path, { mode: 0o700 });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("digital-life: unable to allocate a project directory");
}

/** WorkBuddy-compatible canonical agent location. */
export function agentPath(id: string, stateDir?: string): string {
  return join(digitalLifeHome(process.env, stateDir), id, "agents", `${id}.md`);
}

/**
 * Return the portable path stored for a managed identity.
 * @param id Digital-life record ID.
 * @returns A path relative to the configured digital-life state directory.
 */
export function managedAgentBinding(id: string): string {
  return `${id}/agents/${id}.md`;
}

function legacyAgentsPath(id: string, stateDir?: string): string {
  return join(digitalLifeHome(process.env, stateDir), id, "AGENTS.md");
}

function expandAgentPath(value: string, stateDir?: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\"))
    return join(homedir(), value.slice(2));
  return value.startsWith("/") ? resolve(value) : resolve(digitalLifeHome(process.env, stateDir), value);
}

/** Agent files may carry YAML frontmatter; only the Markdown body is identity. */
export function agentIdentity(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const end = normalized.indexOf("\n---\n", 4);
  return (end === -1 ? normalized : normalized.slice(end + 5)).trim();
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

/** Render a Claude/WorkBuddy-compatible agent file. */
export function agentDocument(record: DigitalLifeRecord, identity: string): string {
  const lines = [
    "---",
    `name: ${yamlString(record.id)}`,
    `description: ${yamlString(record.description || record.name)}`,
  ];
  if (record.toolFilter !== undefined)
    lines.push(`tools: ${yamlString(record.toolFilter.join(", "))}`);
  lines.push(`model: ${yamlString(record.model?.model ?? "inherit")}`, "---", "", identity.trim());
  return `${lines.join("\n")}\n`;
}

async function readIdentityFile(path: string): Promise<string> {
  const value = await readFile(path, { encoding: "utf8" });
  if (Buffer.byteLength(value) > MAX_IDENTITY_BYTES)
    throw new Error(`identity file exceeds ${String(MAX_IDENTITY_BYTES)} bytes`);
  const identity = agentIdentity(value);
  if (identity === "") throw new Error("identity file is empty");
  return identity;
}

/**
 * Read an Agent Markdown identity from an absolute, home-relative, or state-relative path.
 * @param path Agent file path stored in settings.
 * @param stateDir Optional digital-life state directory for relative paths.
 * @returns The Markdown body without YAML frontmatter.
 */
export async function readAgentIdentity(path: string, stateDir?: string): Promise<string> {
  try {
    return await readIdentityFile(expandAgentPath(path, stateDir));
  } catch (error) {
    throw new Error(`digital-life: cannot load agent "${path}": ${String(error)}`);
  }
}

/** Read the canonical persisted expert identity. */
export async function identityFor(record: DigitalLifeRecord, stateDir?: string): Promise<string> {
  if (record.expertPackage !== undefined) return agentIdentity(await readPackageIdentity(record.expertPackage, stateDir));
  if (record.agent !== undefined) return readAgentIdentity(record.agent, stateDir);
  try {
    return await readIdentityFile(agentPath(record.id, stateDir));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (record.persona.trim() !== "") return record.persona.trim();
  throw new Error(`digital-life: no identity configured for "${record.id}"`);
}

/** Write beside the target, then rename over it, so a reader never sees a truncated file. */
async function writeAtomically(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function persist(
  record: DigitalLifeRecord,
  stateDir?: string,
  mode: "create" | "update" = "create",
): Promise<void> {
  const binding = record.agent?.trim();
  const managed = binding === undefined || binding === managedAgentBinding(record.id);
  if (!managed) {
    await readAgentIdentity(binding, stateDir);
    return;
  }
  const { agent: _agent, ...withoutAgent } = record;
  const identity = mode === "update"
    ? record.persona.trim() || await identityFor(withoutAgent, stateDir)
    : record.persona.trim();
  if (identity === "")
    throw new Error(`digital-life: no identity configured for "${record.id}"`);
  const path = agentPath(record.id, stateDir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeAtomically(path, agentDocument(record, identity));
}

/** Wait for every task, so none is still writing when the first failure is reported. */
async function allDone(tasks: readonly Promise<unknown>[]): Promise<void> {
  const outcomes = await Promise.allSettled(tasks);
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
}

/** Ensure every managed life owns agents/<id>.md and migrate the old AGENTS.md layout. */
export async function initializeIdentities(
  records: readonly DigitalLifeRecord[],
  stateDir?: string,
): Promise<void> {
  await allDone(records.map(async (record) => {
    if (record.agent !== undefined && record.agent !== managedAgentBinding(record.id)) {
      await readAgentIdentity(record.agent, stateDir);
      return;
    }
    try {
      await readFile(agentPath(record.id, stateDir));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        const legacy = await readIdentityFile(legacyAgentsPath(record.id, stateDir));
        const path = agentPath(record.id, stateDir);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeAtomically(path, agentDocument(record, legacy));
        await rm(legacyAgentsPath(record.id, stateDir), { force: true });
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError;
        await persist(record, stateDir);
      }
    }
  }));
}

/** Persist identity/metadata edits and remove storage for deleted records. */
export async function reconcileIdentities(
  previous: readonly DigitalLifeRecord[],
  next: readonly DigitalLifeRecord[],
  stateDir?: string,
): Promise<void> {
  const old = new Map(previous.map((record) => [record.id, record]));
  const ids = new Set(next.map((record) => record.id));
  await allDone([
    ...next.map(async (record) => {
      const before = old.get(record.id);
      if (before === undefined) {
        await persist(record, stateDir, "create");
      } else if (JSON.stringify(before) !== JSON.stringify(record)) {
        await persist(record, stateDir, "update");
      }
    }),
    ...previous.filter((record) => !ids.has(record.id)).map((record) =>
      rm(join(digitalLifeHome(process.env, stateDir), record.id), { recursive: true, force: true }),
    ),
  ]);
}
