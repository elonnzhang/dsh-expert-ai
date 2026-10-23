import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The nearest package.json above a source or compiled module directory. */
export function packageRootFrom(directory: string): string | undefined {
  for (let current = directory; ; current = dirname(current)) {
    if (existsSync(join(current, "package.json"))) return current;
    if (dirname(current) === current) return undefined;
  }
}

/**
 * The plugin package that ships `experts/`. Exported for the identity readers, not
 * as part of the identity barrel's public API.
 */
export const PLUGIN_PACKAGE_ROOT = packageRootFrom(dirname(fileURLToPath(import.meta.url)));

/** Resolve the plugin's storage root: `<stateDir or $DSH_HOME or ~/.dsh>/expert-ai`. */
export function expertAiHome(
  env: Record<string, string | undefined> = process.env,
  stateDir?: string,
): string {
  const explicitStateDir = stateDir?.trim();
  const configured = explicitStateDir || env.DSH_HOME?.trim();
  if (configured === undefined || configured === "")
    return join(homedir(), ".dsh", "expert-ai");
  const expanded = configured === "~"
    ? homedir()
    : configured.startsWith("~/") || configured.startsWith("~\\")
      ? join(homedir(), configured.slice(2))
      : configured;
  const root = resolve(expanded);
  // Only an explicit `stateDir` may name the data directory itself.
  // DSH_HOME always names the Harness root, even when it ends in expert-ai.
  return explicitStateDir && root.endsWith(`${sep}expert-ai`) ? root : join(root, "expert-ai");
}

/** Create an empty working directory for an expert conversation. */
export async function createProject(stateDir?: string): Promise<string> {
  const projects = join(expertAiHome(process.env, stateDir), "projects");
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
  throw new Error("expert-ai: unable to allocate a project directory");
}

/** WorkBuddy-compatible canonical agent location. */
export function agentPath(id: string, stateDir?: string): string {
  return join(expertAiHome(process.env, stateDir), id, "agents", `${id}.md`);
}
