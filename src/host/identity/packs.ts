import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { EXPERT_AI_CATEGORIES, EXPERT_SOURCE_KINDS } from "../../constants.js";
import type {
  ExpertPackManifestV2,
  ExpertReference,
} from "../../expert-types.js";
import type { CanonicalExpertRecord, ExpertCategory, ExpertOrigin } from "../../types.js";
import { BUNDLED_PATH, ID_PATTERN, PACKAGE_REVISION, PACKAGE_SLUG, legacyPackageAgentPath, packageAgentPath, validPackageRef } from "../../record-model.js";
import { agentIdentity } from "./markdown.js";
import { expertAiHome, PLUGIN_PACKAGE_ROOT } from "./paths.js";

export const MIMEOGRAPHS_REPOSITORY = "K-Dense-AI/mimeographs";
export const MAX_PACK_FILE_BYTES = 256 * 1024;
export const PACK_REFERENCE_PATH = /^references\/[a-z0-9][a-z0-9-]*\.md$/;

const MAX_PACK_FILES = 27;
const SHA256 = /^[a-f0-9]{64}$/;
const PACK_FILES = new Set(["AGENTS.md", "SKILL.md", "LICENSE"]);

export interface PackLocation {
  kind: "bundled" | "package";
  /** Absolute directory containing manifest.json. */
  root: string;
}

type PackOrigin = Extract<ExpertOrigin, { kind: "bundled" | "package" }>;

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("expert-ai: invalid expert manifest");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("expert-ai: invalid expert manifest");
  return value;
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`expert-ai: invalid expert manifest ${field}`);
  return value;
}

function categoryOf(value: unknown): ExpertCategory {
  if (typeof value !== "string" || !(EXPERT_AI_CATEGORIES as readonly string[]).includes(value))
    throw new Error("expert-ai: invalid expert manifest");
  return value as ExpertCategory;
}

function sourceOf(value: unknown): ExpertPackManifestV2["source"] {
  const raw = object(value);
  if (typeof raw.kind !== "string" || !(EXPERT_SOURCE_KINDS as readonly string[]).includes(raw.kind))
    throw new Error("expert-ai: invalid expert manifest");
  const note = optionalText(raw.note, "source.note");
  return { kind: raw.kind as ExpertPackManifestV2["source"]["kind"], ...(note === undefined ? {} : { note }) };
}

function fileListOf(value: unknown): ExpertPackManifestV2["files"] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_PACK_FILES)
    throw new Error("expert-ai: invalid expert manifest");
  const seen = new Set<string>();
  return value.map((entry) => {
    const file = object(entry);
    const path = text(file.path);
    if (!fileAllowed(path) || seen.has(path) || typeof file.sha256 !== "string" || !SHA256.test(file.sha256) ||
        !Number.isInteger(file.bytes) || (file.bytes as number) < 1 || (file.bytes as number) > MAX_PACK_FILE_BYTES)
      throw new Error("expert-ai: invalid expert manifest");
    seen.add(path);
    return { path, sha256: file.sha256, bytes: file.bytes as number };
  });
}

function fileAllowed(path: string): boolean {
  return PACK_FILES.has(path) || PACK_REFERENCE_PATH.test(path);
}

function provenanceOf(value: unknown): ExpertPackManifestV2["provenance"] {
  const raw = object(value);
  const collection = text(raw.collection);
  const slug = optionalText(raw.slug, "provenance.slug");
  const revision = optionalText(raw.revision, "provenance.revision");
  const importedAt = optionalText(raw.importedAt, "provenance.importedAt");
  return {
    collection,
    ...(slug === undefined ? {} : { slug }),
    ...(revision === undefined ? {} : { revision }),
    ...(importedAt === undefined ? {} : { importedAt }),
  };
}

function validateManifestFiles(manifest: ExpertPackManifestV2): void {
  const paths = new Set(manifest.files.map((file) => file.path));
  if (!paths.has("AGENTS.md")) throw new Error("expert-ai: invalid expert manifest");
  if (manifest.origin === "package" && !paths.has("LICENSE"))
    throw new Error("expert-ai: invalid expert manifest");
}

function parseV2(value: Record<string, unknown>, origin: PackOrigin): ExpertPackManifestV2 {
  if (value.origin !== origin.kind || typeof value.id !== "string" || !ID_PATTERN.test(value.id) ||
      typeof value.name !== "string" || value.name.trim() === "" || typeof value.description !== "string" ||
      !Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string"))
    throw new Error("expert-ai: invalid expert manifest");
  const title = optionalText(value.title, "title");
  const manifest: ExpertPackManifestV2 = {
    schemaVersion: 2,
    origin: origin.kind,
    id: value.id,
    name: value.name,
    ...(title === undefined ? {} : { title }),
    description: value.description,
    category: categoryOf(value.category),
    tags: [...new Set(value.tags as string[])],
    source: sourceOf(value.source),
    provenance: provenanceOf(value.provenance),
    files: fileListOf(value.files),
  };
  validateManifestFiles(manifest);
  const provenance = manifest.provenance;
  if (origin.kind === "package") {
    if (manifest.id !== origin.slug || provenance.collection !== origin.source || provenance.slug !== origin.slug ||
        typeof provenance.revision !== "string" || !PACKAGE_REVISION.test(provenance.revision) || typeof provenance.importedAt !== "string")
      throw new Error("expert-ai: invalid expert manifest");
  } else {
    const folder = origin.path.split("/").at(-1) ?? "";
    if (manifest.id.toLowerCase() !== folder.toLowerCase() ||
        (provenance.revision !== undefined && !PACKAGE_REVISION.test(provenance.revision)))
      throw new Error("expert-ai: invalid expert manifest");
  }
  return manifest;
}

function upgradeV1(value: Record<string, unknown>, origin: PackOrigin): ExpertPackManifestV2 {
  if (origin.kind !== "package" || value.schemaVersion !== 1 || value.source !== origin.source ||
      value.slug !== origin.slug || typeof value.revision !== "string" || !PACKAGE_REVISION.test(value.revision) || value.sourceType !== "public-method" ||
      typeof value.name !== "string" || value.name.trim() === "" || typeof value.description !== "string" ||
      typeof value.importedAt !== "string")
    throw new Error("expert-ai: invalid expert manifest");
  const files = fileListOf(value.files);
  const paths = new Set(files.map((file) => file.path));
  if (!["AGENTS.md", "SKILL.md", "LICENSE"].every((path) => paths.has(path)))
    throw new Error("expert-ai: invalid expert manifest");
  return {
    schemaVersion: 2,
    origin: "package",
    id: origin.slug,
    name: value.name,
    description: value.description,
    category: categoryOf(value.category),
    tags: ["mimeographs", "public-method"],
    source: { kind: "public" },
    provenance: {
      collection: "mimeographs",
      slug: origin.slug,
      revision: value.revision as string,
      importedAt: value.importedAt,
    },
    files,
  };
}

/** Resolve a bundled or imported pack's directory. Bundled packs never use a data-directory override. */
export function packLocation(origin: PackOrigin, stateDir?: string): PackLocation {
  validateOrigin(origin);
  if (origin.kind === "bundled") {
    if (PLUGIN_PACKAGE_ROOT === undefined) throw new Error("expert-ai: plugin package root is unavailable");
    return { kind: "bundled", root: join(PLUGIN_PACKAGE_ROOT, origin.path) };
  }
  const home = expertAiHome(process.env, stateDir);
  const root = dirname(join(home, packageAgentPath(origin)));
  const legacy = dirname(join(home, legacyPackageAgentPath(origin)));
  // Check the directory itself (including a broken symlink), not just manifest.json:
  // a damaged new package must fail verification instead of silently reading an old one.
  for (const candidate of [root, legacy]) {
    try {
      lstatSync(candidate);
      return { kind: "package", root: candidate };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return { kind: "package", root };
}

function validateOrigin(origin: PackOrigin): void {
  if (origin.kind === "bundled") {
    if (!BUNDLED_PATH.test(origin.path))
      throw new Error("expert-ai: bundled origin must name a directory under experts/");
    return;
  }
  if (origin.kind !== "package" || origin.source !== "mimeographs" ||
      !PACKAGE_REVISION.test(origin.revision) || !PACKAGE_SLUG.test(origin.slug))
    throw new Error("expert-ai: invalid expert package; use a slug and a full lowercase commit SHA");
  if (typeof origin.ref !== "string" || !validPackageRef(origin.ref))
    throw new Error("expert-ai: invalid expert package; a branch or tag is required");
}

async function assertPackRoot(location: PackLocation): Promise<string> {
  if (!isAbsolute(location.root)) throw new Error("expert-ai: expert pack root must be absolute");
  const original = await lstat(resolve(location.root));
  if (original.isSymbolicLink() || !original.isDirectory())
    throw new Error("expert-ai: symlinked expert packages are not supported");
  const root = await realpath(location.root);
  if (!(await lstat(root)).isDirectory())
    throw new Error("expert-ai: symlinked expert packages are not supported");
  return root;
}

/** Read and validate a v2 manifest, upgrading a v1 mimeographs manifest in memory. */
export async function loadPackManifest(location: PackLocation, origin: PackOrigin): Promise<ExpertPackManifestV2> {
  validateOrigin(origin);
  if (location.kind !== origin.kind) throw new Error("expert-ai: invalid expert manifest");
  const root = await assertPackRoot(location);
  const manifestFile = join(root, "manifest.json");
  const status = await lstat(manifestFile);
  if (status.isSymbolicLink()) throw new Error("expert-ai: symlinked expert manifests are not supported");
  if (status.size > MAX_PACK_FILE_BYTES) throw new Error("expert-ai: expert manifest is too large");
  const raw = await readFile(manifestFile, "utf8");
  if (Buffer.byteLength(raw) > MAX_PACK_FILE_BYTES) throw new Error("expert-ai: expert manifest is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("expert-ai: invalid expert manifest");
  }
  const value = object(parsed);
  if (value.schemaVersion === 1) return upgradeV1(value, origin);
  if (value.schemaVersion !== 2) throw new Error("expert-ai: invalid expert manifest");
  return parseV2(value, origin);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Read one declared pack file after checking containment, size, and sha256. */
export async function readPackFile(
  location: PackLocation,
  manifest: ExpertPackManifestV2,
  path: string,
): Promise<string> {
  const entry = manifest.files.find((file) => file.path === path);
  if (entry === undefined || !fileAllowed(path) || manifest.origin !== location.kind ||
      !Number.isInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > MAX_PACK_FILE_BYTES || !SHA256.test(entry.sha256))
    throw new Error("expert-ai: file is not in the expert manifest");
  const root = await assertPackRoot(location);
  const candidate = join(root, path);
  const file = await realpath(candidate);
  const inside = relative(root, file);
  if (inside === "" || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
    throw new Error(`expert-ai: expert file escapes its expert package: ${path}`);
  let component = root;
  for (const part of path.split("/")) {
    component = join(component, part);
    if ((await lstat(component)).isSymbolicLink())
      throw new Error(`expert-ai: symlinked expert files are not supported: ${path}`);
  }
  const status = await lstat(file);
  if (!status.isFile() || status.size !== entry.bytes)
    throw new Error(`expert-ai: expert file size changed: ${path}`);
  const body = await readFile(file, "utf8");
  if (Buffer.byteLength(body) !== entry.bytes || sha256(body) !== entry.sha256)
    throw new Error(`expert-ai: expert file integrity check failed: ${path}`);
  return body;
}

/** Read the AGENTS.md body of a bundled or imported pack. */
export async function readPackIdentity(origin: PackOrigin, stateDir?: string): Promise<string> {
  const location = packLocation(origin, stateDir);
  const manifest = await loadPackManifest(location, origin);
  const identity = agentIdentity(await readPackFile(location, manifest, "AGENTS.md"));
  if (identity === "") throw new Error("expert-ai: identity file is empty");
  return identity;
}

/** List the reference files declared by a pack without reading their contents. */
export async function listPackReferences(
  origin: PackOrigin,
  stateDir?: string,
): Promise<{ revision?: string; files: ExpertPackManifestV2["files"] }> {
  const manifest = await loadPackManifest(packLocation(origin, stateDir), origin);
  return {
    ...(manifest.provenance.revision === undefined ? {} : { revision: manifest.provenance.revision }),
    files: manifest.files.filter((file) => PACK_REFERENCE_PATH.test(file.path)),
  };
}

/** Read a declared reference from either kind of pack. */
export async function readPackReference(
  record: CanonicalExpertRecord,
  path: string,
  stateDir?: string,
  maxCharacters = 12_000,
): Promise<ExpertReference> {
  if (record.origin.kind !== "bundled" && record.origin.kind !== "package")
    throw new Error("expert-ai: this expert has no reference package");
  if (!PACK_REFERENCE_PATH.test(path))
    throw new Error("expert-ai: only declared references/*.md files can be read");
  const origin = record.origin;
  const location = packLocation(origin, stateDir);
  const manifest = await loadPackManifest(location, origin);
  const source = await readPackFile(location, manifest, path);
  const revision = manifest.provenance.revision ?? "bundled";
  return {
    id: `${record.id}@${revision}:${path}`,
    expertId: record.id,
    path,
    revision,
    sha256: sha256(source),
    ...(origin.kind === "package"
      ? {
          sourceUrl:
            `https://github.com/${MIMEOGRAPHS_REPOSITORY}/blob/${revision}/mimeographs/${origin.slug}/${path}`,
        }
      : {}),
    text: source.slice(0, maxCharacters),
    truncated: source.length > maxCharacters,
  };
}
