import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { expertAiHome } from "./identity.js";
import type { ExpertPackageBinding, ExpertPackageLocation, ExpertPackageManifest } from "../expert-types.js";

const MAX_FILE_BYTES = 256 * 1024;
const PACKAGE_SOURCES = ["mimeographs"] as const;
const REVISION = /^[a-f0-9]{40}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validRef(value: string): boolean {
  return REF.test(value) && !value.includes("..") && !value.endsWith("/") && !value.endsWith(".lock");
}

function validatePackageLocation(location: ExpertPackageLocation): void {
  if (!(PACKAGE_SOURCES as readonly string[]).includes(location.source) || !SLUG.test(location.slug) ||
      !REVISION.test(location.revision))
    throw new Error("expert-ai: invalid expert package; use a slug and a full lowercase commit SHA");
}

export function validatePackageBinding(binding: ExpertPackageBinding): void {
  validatePackageLocation(binding);
  if (typeof binding.ref !== "string" || !validRef(binding.ref))
    throw new Error("expert-ai: invalid expert package; a branch or tag is required");
}

export function packageAgentBinding(binding: ExpertPackageLocation): string {
  validatePackageLocation(binding);
  return `.expert-packages/${binding.source}/${binding.revision}/${binding.slug}/AGENTS.md`;
}

function packageRoot(binding: ExpertPackageLocation, stateDir?: string): string {
  return dirname(join(expertAiHome(process.env, stateDir), packageAgentBinding(binding)));
}

export async function loadExpertPackage(binding: ExpertPackageLocation, stateDir?: string): Promise<ExpertPackageManifest> {
  const root = packageRoot(binding, stateDir);
  if ((await lstat(root)).isSymbolicLink()) throw new Error("expert-ai: symlinked expert packages are not supported");
  const raw = await readFile(join(root, "manifest.json"), "utf8");
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error("expert-ai: expert manifest is too large");
  const value = JSON.parse(raw) as ExpertPackageManifest;
  if (value === null || value.schemaVersion !== 1 || value.source !== binding.source || value.slug !== binding.slug ||
      value.revision !== binding.revision || value.sourceType !== "public-method" || value.reviewStatus !== "unreviewed" ||
      typeof value.name !== "string" || typeof value.description !== "string" || typeof value.importedAt !== "string" ||
      typeof value.category !== "string" || !Array.isArray(value.files) || value.files.length > 27 ||
      value.files.some((file) => !file || typeof file.path !== "string" ||
        typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_FILE_BYTES) ||
      new Set(value.files.map((file) => file.path)).size !== value.files.length ||
      !value.files.some((file) => file.path === "AGENTS.md"))
    throw new Error("expert-ai: invalid expert manifest");
  return value;
}

async function verifiedFile(manifest: ExpertPackageManifest, path: string, stateDir?: string): Promise<string> {
  const entry = manifest.files.find((file) => file.path === path);
  if (entry === undefined) throw new Error("expert-ai: file is not in the expert manifest");
  const root = await realpath(packageRoot(manifest, stateDir));
  const file = await realpath(join(root, path));
  if (!file.startsWith(`${root}${sep}`)) throw new Error("expert-ai: reference escapes its expert package");
  if ((await lstat(file)).size !== entry.bytes) throw new Error(`expert-ai: expert file size changed: ${path}`);
  const text = await readFile(file, "utf8");
  if (Buffer.byteLength(text) !== entry.bytes || sha256(text) !== entry.sha256)
    throw new Error(`expert-ai: expert file integrity check failed: ${path}`);
  return text;
}

export async function readPackageIdentity(binding: ExpertPackageLocation, stateDir?: string): Promise<string> {
  return verifiedFile(await loadExpertPackage(binding, stateDir), "AGENTS.md", stateDir);
}
