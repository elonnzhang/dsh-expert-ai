import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { CanonicalExpertRecord } from "../../types.js";
import { agentDocument, agentIdentity } from "./markdown.js";
import { expertAiHome, PLUGIN_PACKAGE_ROOT, agentPath } from "./paths.js";
import { readPackIdentity } from "./packs.js";

const MAX_IDENTITY_BYTES = 1024 * 1024;

async function readIdentityFile(path: string): Promise<string> {
  const value = await readFile(path, { encoding: "utf8" });
  if (Buffer.byteLength(value) > MAX_IDENTITY_BYTES)
    throw new Error(`identity file exceeds ${String(MAX_IDENTITY_BYTES)} bytes`);
  const identity = agentIdentity(value);
  if (identity === "") throw new Error("identity file is empty");
  return identity;
}

/** File origins accept `~`, absolute paths, and state-relative paths. */
function fileCandidates(path: string, stateDir?: string): string[] {
  if (path === "~") return [homedir()];
  if (path.startsWith("~/") || path.startsWith("~\\")) return [join(homedir(), path.slice(2))];
  if (isAbsolute(path)) return [resolve(path)];
  const inState = resolve(expertAiHome(process.env, stateDir), path);
  return PLUGIN_PACKAGE_ROOT === undefined ? [inState] : [inState, resolve(PLUGIN_PACKAGE_ROOT, path)];
}

async function readFileIdentity(path: string, stateDir?: string): Promise<string> {
  const unreadable = (error: unknown): Error =>
    new Error(`expert-ai: cannot load agent "${path}": ${String(error)}`);
  let missing: unknown;
  for (const candidate of fileCandidates(path, stateDir)) {
    try {
      return await readIdentityFile(candidate);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw unreadable(error);
      missing ??= error;
    }
  }
  throw unreadable(missing);
}

/**
 * Read the identity body for a canonical record. Bundled and package packs are
 * integrity checked; managed records use their file before legacy inline text.
 */
export async function identityFor(record: CanonicalExpertRecord, stateDir?: string): Promise<string> {
  switch (record.origin.kind) {
    case "managed":
      try {
        return await readIdentityFile(agentPath(record.id, stateDir));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (record.persona.trim() !== "") return record.persona.trim();
      throw new Error(`expert-ai: no identity configured for "${record.id}"`);
    case "file":
      return readFileIdentity(record.origin.path, stateDir);
    case "bundled":
    case "package":
      return readPackIdentity(record.origin, stateDir);
  }
}

/** Write beside the target, then rename over it, so a reader never sees a truncated file. */
async function writeAtomically(path: string, text: string): Promise<void> {
  const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeManaged(record: CanonicalExpertRecord, identity: string, stateDir?: string): Promise<void> {
  if (identity.trim() === "") throw new Error(`expert-ai: no identity configured for "${record.id}"`);
  const path = agentPath(record.id, stateDir);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeAtomically(path, agentDocument(record, identity));
}

async function ensureManaged(record: CanonicalExpertRecord, stateDir?: string): Promise<void> {
  const path = agentPath(record.id, stateDir);
  try {
    await readFile(path);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const legacy = join(expertAiHome(process.env, stateDir), record.id, "AGENTS.md");
  try {
    const identity = await readIdentityFile(legacy);
    await writeManaged(record, identity, stateDir);
    await rm(legacy, { force: true });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeManaged(record, record.persona, stateDir);
}

/** Wait for every task, so none is still writing when the first failure is reported. */
async function allDone(tasks: readonly Promise<unknown>[]): Promise<void> {
  const outcomes = await Promise.allSettled(tasks);
  for (const outcome of outcomes) if (outcome.status === "rejected") throw outcome.reason;
}

/** Ensure every managed identity exists and every other origin is readable. */
export async function initializeIdentities(
  records: readonly CanonicalExpertRecord[],
  stateDir?: string,
): Promise<void> {
  await allDone(records.map(async (record) => {
    if (record.origin.kind === "managed") await ensureManaged(record, stateDir);
    else await identityFor(record, stateDir);
  }));
}

async function persist(
  record: CanonicalExpertRecord,
  stateDir?: string,
  mode: "create" | "update" = "create",
): Promise<void> {
  if (record.origin.kind !== "managed") {
    await identityFor(record, stateDir);
    return;
  }
  const identity = mode === "update"
    ? record.persona.trim() || await identityFor(record, stateDir)
    : record.persona.trim();
  await writeManaged(record, identity, stateDir);
}

/** Persist managed identities and remove storage only for records that were managed. */
export async function reconcileIdentities(
  previous: readonly CanonicalExpertRecord[],
  next: readonly CanonicalExpertRecord[],
  stateDir?: string,
  applied?: (id: string, record: CanonicalExpertRecord | undefined) => void,
): Promise<void> {
  const old = new Map(previous.map((record) => [record.id, record]));
  const ids = new Set(next.map((record) => record.id));
  await allDone([
    ...next.map(async (record) => {
      const before = old.get(record.id);
      if (before !== undefined && JSON.stringify(before) === JSON.stringify(record)) return;
      await persist(record, stateDir, before === undefined ? "create" : "update");
      applied?.(record.id, record);
    }),
    ...previous.filter((record) => !ids.has(record.id)).map(async (record) => {
      if (record.origin.kind === "managed")
        await rm(join(expertAiHome(process.env, stateDir), record.id), { recursive: true, force: true });
      applied?.(record.id, undefined);
    }),
  ]);
}
