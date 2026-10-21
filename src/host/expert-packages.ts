import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { expertAiHome } from "./identity.js";
import type {
  ExpertCatalogEntry,
  ExpertPackageBinding,
  ExpertPackageLocation,
  ExpertPackageManifest,
  ExpertReference,
} from "../expert-types.js";
import type { ExpertCategory, ExpertRecord } from "../types.js";

const REPOSITORY = "K-Dense-AI/mimeographs";
const MAX_FILE_BYTES = 256 * 1024;
const PACKAGE_SOURCES = ["mimeographs"] as const;
const REVISION = /^[a-f0-9]{40}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const REFERENCE = /^references\/[a-z0-9][a-z0-9-]*\.md$/;
const CATEGORIES: Record<string, ExpertCategory> = {
  "Founders & operators": "business",
  Philosophers: "culture",
  "AI & ML researchers": "tech",
  "Scientists & researchers": "science",
};

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

function fileAllowed(path: string): boolean {
  return path === "AGENTS.md" || path === "SKILL.md" || path === "LICENSE" || REFERENCE.test(path);
}

async function fetchText(path: string, revision: string, fetcher: typeof fetch): Promise<string> {
  if (!REVISION.test(revision)) throw new Error("expert-ai: a full commit SHA is required");
  const response = await fetcher(`https://raw.githubusercontent.com/${REPOSITORY}/${revision}/${path}`, {
    signal: AbortSignal.timeout(20_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`expert-ai: download failed (${response.status}): ${path}`);
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error(`expert-ai: empty download: ${path}`);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_FILE_BYTES) throw new Error(`expert-ai: download exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw new Error("expert-ai: empty download: " + path);
  return text;
}

/** Read the commit a branch or tag points to when the unauthenticated REST API is rate limited. */
async function resolveViaGit(fetcher: typeof fetch, path: string, value: string): Promise<Response | undefined> {
  let response: Response;
  try {
    response = await fetcher(`https://github.com/${REPOSITORY}/commits/${path}.atom`, {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  const match = /Grit::Commit\/([a-f0-9]{40})/i.exec(await response.text());
  if (match === null) throw new Error(`expert-ai: version lookup returned an invalid commit: ${value}`);
  return new Response(match[1]!.toLowerCase());
}

/** Lookup caches sit beside the commit directories; their names can never be a 40-character SHA. */
function cacheRoot(home: string): string {
  return join(home, ".expert-packages", "mimeographs");
}

async function readCached(path: string): Promise<string | undefined> {
  try {
    if ((await lstat(path)).size > MAX_FILE_BYTES) return undefined;
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Write through a sibling temporary file so readers never see a partial cache entry. */
async function writeCached(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function cachedRefs(home: string): Promise<Record<string, string>> {
  try {
    const value: unknown = JSON.parse((await readCached(join(cacheRoot(home), "refs.json"))) ?? "{}");
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/**
 * Resolve a branch or tag to the commit it points to now; downloads and storage use that commit.
 * With `home`, each lookup is remembered so an unreachable GitHub falls back to the last known commit.
 * @returns The lowercase 40-character commit SHA, and whether it came from the local cache.
 */
export async function resolveRevision(
  ref: string,
  fetcher: typeof fetch = fetch,
  home?: string,
): Promise<{ revision: string; cached: boolean }> {
  const value = ref.trim();
  if (!validRef(value)) throw new Error("expert-ai: invalid version; use a branch or tag");
  const path = value.split("/").map(encodeURIComponent).join("/");
  let response: Response;
  try {
    response = await fetcher(`https://api.github.com/repos/${REPOSITORY}/commits/${path}`, {
      headers: { Accept: "application/vnd.github.sha" },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch (error) {
    const known = home === undefined ? undefined : (await cachedRefs(home))[value];
    if (known !== undefined && REVISION.test(known)) return { revision: known, cached: true };
    const fallback = await resolveViaGit(fetcher, path, value);
    if (fallback === undefined) throw error;
    response = fallback;
  }
  if (response.status === 404 || response.status === 422) {
    const fallback = await resolveViaGit(fetcher, path, value);
    if (fallback === undefined) throw new Error(`expert-ai: version not found: ${value}`);
    response = fallback;
  }
  if (!response.ok) {
    // Rate limits and outages are transient; a previously resolved commit is still a valid pin.
    const known = home === undefined ? undefined : (await cachedRefs(home))[value];
    if (known !== undefined && REVISION.test(known)) return { revision: known, cached: true };
    const fallback = await resolveViaGit(fetcher, path, value);
    if (fallback === undefined) throw new Error(`expert-ai: version lookup failed (${response.status}): ${value}`);
    response = fallback;
  }
  const sha = (await response.text()).trim().toLowerCase();
  if (!REVISION.test(sha)) throw new Error(`expert-ai: version lookup returned an invalid commit: ${value}`);
  if (home !== undefined) {
    const refs = await cachedRefs(home);
    if (refs[value] !== sha) await writeCached(join(cacheRoot(home), "refs.json"), JSON.stringify({ ...refs, [value]: sha }, null, 2));
  }
  return { revision: sha, cached: false };
}

/**
 * Load and validate the expert catalog at one commit.
 * With `home`, the catalog is cached per commit; a commit never changes, so the cache never expires.
 */
export async function loadExpertCatalog(
  revision: string,
  fetcher: typeof fetch = fetch,
  home?: string,
): Promise<ExpertCatalogEntry[]> {
  if (!REVISION.test(revision)) throw new Error("expert-ai: a full commit SHA is required");
  const cachePath = home === undefined ? undefined : join(cacheRoot(home), "catalogs", `${revision}.json`);
  const cached = cachePath === undefined ? undefined : await readCached(cachePath);
  if (cached !== undefined) {
    try {
      return parseCatalog(cached);
    } catch {
      // A damaged cache entry is replaced by a fresh download below.
    }
  }
  const text = await fetchText("catalog.json", revision, fetcher);
  const experts = parseCatalog(text);
  if (cachePath !== undefined) await writeCached(cachePath, text);
  return experts;
}

function parseCatalog(text: string): ExpertCatalogEntry[] {
  const data: unknown = JSON.parse(text);
  if (typeof data !== "object" || data === null || !Array.isArray((data as { experts?: unknown }).experts))
    throw new Error("expert-ai: invalid expert catalog");
  const experts = (data as { experts: unknown[] }).experts;
  if (experts.length > 500) throw new Error("expert-ai: expert catalog is too large");
  const ids = new Set<string>();
  return experts.map((value) => {
    const item = value as Record<string, unknown>;
    if (typeof item !== "object" || item === null || typeof item.slug !== "string" || !SLUG.test(item.slug) ||
        typeof item.name !== "string" || item.name.trim() === "" || typeof item.description !== "string" ||
        typeof item.category !== "string" || !Object.hasOwn(CATEGORIES, item.category) ||
        item.path !== `mimeographs/${item.slug}` || ids.has(item.slug))
      throw new Error("expert-ai: invalid or duplicate catalog entry");
    const files = item.files as { agents?: unknown; skill?: unknown; references?: unknown } | undefined;
    if (files?.agents !== true || files.skill !== true || !Array.isArray(files.references) ||
        files.references.length > 24 || files.references.some((path: unknown) => typeof path !== "string" || !REFERENCE.test(path)))
      throw new Error(`expert-ai: invalid reference list for ${item.slug}`);
    ids.add(item.slug);
    return {
      slug: item.slug,
      name: item.name,
      description: item.description,
      category: CATEGORIES[item.category]!,
      references: [...new Set(files.references as string[])],
    };
  });
}

export async function loadExpertPackage(binding: ExpertPackageLocation, stateDir?: string): Promise<ExpertPackageManifest> {
  const root = packageRoot(binding, stateDir);
  if ((await lstat(root)).isSymbolicLink()) throw new Error("expert-ai: symlinked expert packages are not supported");
  const raw = await readFile(join(root, "manifest.json"), "utf8");
  if (Buffer.byteLength(raw) > MAX_FILE_BYTES) throw new Error("expert-ai: expert manifest is too large");
  const value = JSON.parse(raw) as ExpertPackageManifest;
  if (value === null || value.schemaVersion !== 1 || value.source !== binding.source || value.slug !== binding.slug ||
      value.revision !== binding.revision || value.sourceType !== "public-method" ||
      typeof value.name !== "string" || typeof value.description !== "string" || typeof value.importedAt !== "string" ||
      !Object.values(CATEGORIES).includes(value.category) || !Array.isArray(value.files) || value.files.length > 27 ||
      value.files.some((file) => !file || typeof file.path !== "string" || !fileAllowed(file.path) ||
        typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > MAX_FILE_BYTES) ||
      new Set(value.files.map((file) => file.path)).size !== value.files.length ||
      ["AGENTS.md", "SKILL.md", "LICENSE"].some((path) => !value.files.some((file) => file.path === path)))
    throw new Error("expert-ai: invalid expert manifest");
  return {
    schemaVersion: 1,
    source: value.source,
    slug: value.slug,
    revision: value.revision,
    name: value.name,
    description: value.description,
    category: value.category,
    importedAt: value.importedAt,
    sourceType: "public-method",
    files: value.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })),
  };
}

async function verifiedFile(manifest: ExpertPackageManifest, path: string, stateDir?: string): Promise<string> {
  const entry = manifest.files.find((file) => file.path === path);
  if (entry === undefined || !fileAllowed(path)) throw new Error("expert-ai: file is not in the expert manifest");
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

export async function importMimeograph(
  binding: ExpertPackageLocation,
  stateDir?: string,
  fetcher: typeof fetch = fetch,
): Promise<ExpertPackageManifest> {
  validatePackageLocation(binding);
  try {
    const existing = await loadExpertPackage(binding, stateDir);
    await Promise.all(existing.files.map((file) => verifiedFile(existing, file.path, stateDir)));
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // An incomplete existing package must not be silently replaced.
    try {
      await lstat(packageRoot(binding, stateDir));
      throw new Error("expert-ai: incomplete expert package; refusing to overwrite it");
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
    }
  }
  const expert = (await loadExpertCatalog(binding.revision, fetcher, expertAiHome(process.env, stateDir)))
    .find((entry) => entry.slug === binding.slug);
  if (expert === undefined) throw new Error(`expert-ai: unknown upstream expert ${binding.slug}`);
  const paths = ["AGENTS.md", "SKILL.md", "LICENSE", ...expert.references];
  const contents = await Promise.all(paths.map(async (path) => ({
    path,
    text: await fetchText(path === "LICENSE" ? path : `mimeographs/${binding.slug}/${path}`, binding.revision, fetcher),
  })));
  const manifest: ExpertPackageManifest = {
    schemaVersion: 1,
    source: binding.source,
    slug: binding.slug,
    revision: binding.revision,
    name: expert.name,
    description: expert.description,
    category: expert.category,
    importedAt: new Date().toISOString(),
    sourceType: "public-method",
    files: contents.map(({ path, text }) => ({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })),
  };
  const root = packageRoot(binding, stateDir);
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(dirname(root), ".import-"));
  try {
    for (const content of contents) {
      const path = join(temporary, content.path);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await writeFile(path, content.text, { encoding: "utf8", mode: 0o600 });
    }
    await writeFile(join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    try {
      await rename(temporary, root);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const existing = await loadExpertPackage(binding, stateDir);
      for (const file of existing.files) await verifiedFile(existing, file.path, stateDir);
      return existing;
    }
    return manifest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/**
 * Build the settings record for an imported package.
 * @param ref Branch or tag the package was imported from; defaults to the pinned commit for older callers.
 */
export function recordForPackage(manifest: ExpertPackageManifest, ref = manifest.revision): ExpertRecord {
  const expertPackage: ExpertPackageBinding = { source: manifest.source, slug: manifest.slug, revision: manifest.revision, ref };
  validatePackageBinding(expertPackage);
  return {
    id: manifest.slug,
    name: manifest.name,
    description: manifest.description,
    category: manifest.category,
    tags: ["mimeographs", "public-method"],
    persona: "",
    agent: packageAgentBinding(expertPackage),
    expertPackage,
    toolFilter: ["read_expert_reference"],
    enabled: true,
  };
}

export async function readExpertReference(
  record: ExpertRecord,
  path: string,
  stateDir?: string,
  maxCharacters = 12_000,
): Promise<ExpertReference> {
  if (record.expertPackage === undefined) throw new Error("expert-ai: this expert has no imported reference package");
  if (!REFERENCE.test(path)) throw new Error("expert-ai: only declared references/*.md files can be read");
  const manifest = await loadExpertPackage(record.expertPackage, stateDir);
  const text = await verifiedFile(manifest, path, stateDir);
  return {
    id: `${record.id}@${manifest.revision}:${path}`,
    expertId: record.id,
    path,
    revision: manifest.revision,
    sha256: sha256(text),
    sourceUrl: `https://github.com/${REPOSITORY}/blob/${manifest.revision}/mimeographs/${manifest.slug}/${path}`,
    text: text.slice(0, maxCharacters),
    truncated: text.length > maxCharacters,
  };
}
