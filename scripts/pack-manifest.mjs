#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "manifest.json";

/** Strip YAML frontmatter exactly as the identity layer does. */
export function stripFrontmatter(markdown) {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) return normalized.trim();
  const end = normalized.indexOf("\n---\n", 4);
  return (end === -1 ? normalized : normalized.slice(end + 5)).trim();
}

export function hasFrontmatter(markdown) {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  return normalized.startsWith("---\n");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** List every regular file in a pack except its root manifest, sorted by path. */
export async function packFiles(packDir) {
  const files = [];

  async function walk(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      if (prefix === "" && entry.name === MANIFEST) continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute, path);
      } else if (entry.isFile()) {
        const data = await readFile(absolute);
        files.push({ path, sha256: sha256(data), bytes: data.byteLength });
      } else if (entry.isSymbolicLink()) {
        throw new Error(`pack contains a symbolic link: ${path}`);
      }
    }
  }

  await walk(packDir, "");
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return files;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readManifest(packDir) {
  const path = join(packDir, MANIFEST);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isObject(parsed)) throw new Error(`${path}: manifest must be a JSON object`);
  return parsed;
}

function samePaths(actual, expected) {
  return actual.length === expected.length && actual.every((path, index) => path === expected[index]);
}

/** Return every manifest or AGENTS.md integrity problem in one pack. */
export async function packManifestIssues(packDir) {
  const issues = [];
  let manifest;
  try {
    manifest = await readManifest(packDir);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const expected = await packFiles(packDir);
  const actual = manifest.files;
  if (!Array.isArray(actual)) {
    issues.push(`${MANIFEST}: files must be an array`);
  } else {
    const actualPaths = actual.map((entry) => isObject(entry) && typeof entry.path === "string" ? entry.path : undefined);
    const expectedPaths = expected.map((entry) => entry.path);
    if (!samePaths(actualPaths, expectedPaths)) issues.push(`${MANIFEST}: file list or order differs from disk`);

    const byPath = new Map();
    for (const entry of actual) {
      if (!isObject(entry) || typeof entry.path !== "string") {
        issues.push(`${MANIFEST}: invalid file entry`);
        continue;
      }
      if (byPath.has(entry.path)) issues.push(`${MANIFEST}: duplicate file entry ${entry.path}`);
      byPath.set(entry.path, entry);
    }

    for (const file of expected) {
      const entry = byPath.get(file.path);
      if (entry === undefined) {
        issues.push(`${MANIFEST}: missing file entry ${file.path}`);
        continue;
      }
      if (entry.sha256 !== file.sha256) issues.push(`${MANIFEST}: sha256 differs for ${file.path}`);
      if (entry.bytes !== file.bytes) issues.push(`${MANIFEST}: byte size differs for ${file.path}`);
    }
    for (const path of byPath.keys()) {
      if (!expectedPaths.includes(path)) issues.push(`${MANIFEST}: undeclared file entry ${path}`);
    }
  }

  try {
    const agents = await readFile(join(packDir, "AGENTS.md"), "utf8");
    if (agents.trim() === "") issues.push("AGENTS.md: identity body is empty");
    if (hasFrontmatter(agents)) issues.push("AGENTS.md: frontmatter is not allowed");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      issues.push("AGENTS.md: file is missing");
    } else {
      issues.push(`AGENTS.md: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return issues;
}

/** Replace only manifest.files, preserving every other field. */
export async function rewritePackManifest(packDir) {
  const manifest = await readManifest(packDir);
  const updated = { ...manifest, files: await packFiles(packDir) };
  await writeFile(join(packDir, MANIFEST), `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}

export async function discoverPackDirectories(root) {
  const experts = resolve(root, "experts");
  const packs = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(directory, entry.name);
      try {
        await readFile(join(child, MANIFEST));
        packs.push(child);
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
        await walk(child);
      }
    }
  }
  await walk(experts);
  return packs;
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const unknown = args.filter((arg) => arg.startsWith("--") && arg !== "--check");
  if (unknown.length > 0) {
    console.error(`Unknown option: ${unknown.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  let packs;
  const requested = args.filter((arg) => arg !== "--check").map((path) => resolve(path));
  try {
    packs = requested.length > 0 ? requested : await discoverPackDirectories(process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  if (packs.length === 0) {
    console.error("No expert packs found under experts/");
    process.exitCode = 1;
    return;
  }

  let failed = false;
  for (const pack of packs) {
    try {
      if (check) {
        const issues = await packManifestIssues(pack);
        for (const issue of issues) {
          failed = true;
          const label = relative(process.cwd(), pack) || pack;
          console.error(`${label}: ${issue}`);
        }
      } else {
        await rewritePackManifest(pack);
      }
    } catch (error) {
      failed = true;
      console.error(`${pack}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(check ? `checked ${packs.length} pack(s)` : `updated ${packs.length} pack manifest(s)`);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
