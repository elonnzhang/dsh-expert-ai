import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  ExpertCatalogEntry,
  ExpertPackageLocation,
  ExpertPackManifestV2,
} from "../../expert-types.js";
import type { CanonicalExpertRecord, ExpertCategory } from "../../types.js";
import { normalizeRecord, PACKAGE_REVISION, PACKAGE_SLUG, validPackageRef } from "../../record-model.js";
import {
  MAX_PACK_FILE_BYTES,
  MIMEOGRAPHS_REPOSITORY,
  PACK_REFERENCE_PATH,
  loadPackManifest,
  packLocation,
  readPackFile,
} from "./packs.js";
import { expertAiHome } from "./paths.js";

const CATEGORIES: Record<string, ExpertCategory> = {
  "Founders & operators": "business",
  Philosophers: "culture",
  "AI & ML researchers": "tech",
  "Scientists & researchers": "science",
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function validatePackageLocation(location: ExpertPackageLocation): void {
  if (location.source !== "mimeographs" || !PACKAGE_SLUG.test(location.slug) || !PACKAGE_REVISION.test(location.revision))
    throw new Error("expert-ai: invalid expert package; use a slug and a full lowercase commit SHA");
}

async function fetchText(path: string, revision: string, fetcher: typeof fetch): Promise<string> {
  if (!PACKAGE_REVISION.test(revision)) throw new Error("expert-ai: a full commit SHA is required");
  const response = await fetcher(`https://raw.githubusercontent.com/${MIMEOGRAPHS_REPOSITORY}/${revision}/${path}`, {
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
      if (bytes > MAX_PACK_FILE_BYTES) throw new Error(`expert-ai: download exceeds ${MAX_PACK_FILE_BYTES} bytes: ${path}`);
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (body.trim() === "") throw new Error("expert-ai: empty download: " + path);
  return body;
}

/** Read the commit a branch or tag points to when the unauthenticated REST API is rate limited. */
async function resolveViaGit(fetcher: typeof fetch, path: string, value: string): Promise<Response | undefined> {
  let response: Response;
  try {
    response = await fetcher(`https://github.com/${MIMEOGRAPHS_REPOSITORY}/commits/${path}.atom`, {
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
    if ((await lstat(path)).size > MAX_PACK_FILE_BYTES) return undefined;
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

/** Resolve a branch or tag to the commit it points to now. */
export async function resolveRevision(
  ref: string,
  fetcher: typeof fetch = fetch,
  home?: string,
): Promise<{ revision: string; cached: boolean }> {
  const value = ref.trim();
  if (!validPackageRef(value)) throw new Error("expert-ai: invalid version; use a branch or tag");
  const path = value.split("/").map(encodeURIComponent).join("/");
  let response: Response;
  try {
    response = await fetcher(`https://api.github.com/repos/${MIMEOGRAPHS_REPOSITORY}/commits/${path}`, {
      headers: { Accept: "application/vnd.github.sha" },
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
    });
  } catch (error) {
    const known = home === undefined ? undefined : (await cachedRefs(home))[value];
    if (known !== undefined && PACKAGE_REVISION.test(known)) return { revision: known, cached: true };
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
    const known = home === undefined ? undefined : (await cachedRefs(home))[value];
    if (known !== undefined && PACKAGE_REVISION.test(known)) return { revision: known, cached: true };
    const fallback = await resolveViaGit(fetcher, path, value);
    if (fallback === undefined) throw new Error(`expert-ai: version lookup failed (${response.status}): ${value}`);
    response = fallback;
  }
  const revision = (await response.text()).trim().toLowerCase();
  if (!PACKAGE_REVISION.test(revision)) throw new Error(`expert-ai: version lookup returned an invalid commit: ${value}`);
  if (home !== undefined) {
    const refs = await cachedRefs(home);
    if (refs[value] !== revision)
      await writeCached(join(cacheRoot(home), "refs.json"), JSON.stringify({ ...refs, [value]: revision }, null, 2));
  }
  return { revision, cached: false };
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
    if (typeof item !== "object" || item === null || typeof item.slug !== "string" || !PACKAGE_SLUG.test(item.slug) ||
        typeof item.name !== "string" || item.name.trim() === "" || typeof item.description !== "string" ||
        typeof item.category !== "string" || !Object.hasOwn(CATEGORIES, item.category) ||
        item.path !== `mimeographs/${item.slug}` || ids.has(item.slug))
      throw new Error("expert-ai: invalid or duplicate catalog entry");
    const files = item.files as { agents?: unknown; skill?: unknown; references?: unknown } | undefined;
    if (files?.agents !== true || files.skill !== true || !Array.isArray(files.references) ||
        files.references.length > 24 || files.references.some((path: unknown) => typeof path !== "string" || !PACK_REFERENCE_PATH.test(path)))
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

/** Load and validate the expert catalog at one commit, reusing a cached copy when available. */
export async function loadExpertCatalog(
  revision: string,
  fetcher: typeof fetch = fetch,
  home?: string,
): Promise<ExpertCatalogEntry[]> {
  if (!PACKAGE_REVISION.test(revision)) throw new Error("expert-ai: a full commit SHA is required");
  const cachePath = home === undefined ? undefined : join(cacheRoot(home), "catalogs", `${revision}.json`);
  const cached = cachePath === undefined ? undefined : await readCached(cachePath);
  if (cached !== undefined) {
    try {
      return parseCatalog(cached);
    } catch {
      // A damaged cache entry is replaced by a fresh download below.
    }
  }
  const body = await fetchText("catalog.json", revision, fetcher);
  const experts = parseCatalog(body);
  if (cachePath !== undefined) await writeCached(cachePath, body);
  return experts;
}

/**
 * Import an immutable mimeographs package. Existing packages, including v1
 * manifests, are verified and reused as-is; new packages are written as v2.
 */
export async function importMimeograph(
  location: { source: "mimeographs"; slug: string; revision: string },
  stateDir?: string,
  fetcher: typeof fetch = fetch,
): Promise<ExpertPackManifestV2> {
  validatePackageLocation(location);
  const origin = { kind: "package" as const, ...location, ref: location.revision };
  try {
    const existing = await loadPackManifest(packLocation(origin, stateDir), origin);
    const root = packLocation(origin, stateDir);
    await Promise.all(existing.files.map((file) => readPackFile(root, existing, file.path)));
    return existing;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // An incomplete existing package must not be silently replaced.
    try {
      await lstat(packLocation(origin, stateDir).root);
      throw new Error("expert-ai: incomplete expert package; refusing to overwrite it");
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code !== "ENOENT") throw missing;
    }
  }
  const expert = (await loadExpertCatalog(location.revision, fetcher, expertAiHome(process.env, stateDir)))
    .find((entry) => entry.slug === location.slug);
  if (expert === undefined) throw new Error(`expert-ai: unknown upstream expert ${location.slug}`);
  const paths = ["AGENTS.md", "SKILL.md", "LICENSE", ...expert.references];
  const contents = await Promise.all(paths.map(async (path) => ({
    path,
    text: await fetchText(path === "LICENSE" ? path : `mimeographs/${location.slug}/${path}`, location.revision, fetcher),
  })));
  const manifest: ExpertPackManifestV2 = {
    schemaVersion: 2,
    origin: "package",
    id: location.slug,
    name: expert.name,
    description: expert.description,
    category: expert.category,
    tags: ["mimeographs", "public-method"],
    source: { kind: "public" },
    provenance: {
      collection: "mimeographs",
      slug: location.slug,
      revision: location.revision,
      importedAt: new Date().toISOString(),
    },
    files: contents.map(({ path, text }) => ({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })),
  };
  const root = packLocation(origin, stateDir).root;
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
      const existing = await loadPackManifest(packLocation(origin, stateDir), origin);
      const existingRoot = packLocation(origin, stateDir);
      await Promise.all(existing.files.map((file) => readPackFile(existingRoot, existing, file.path)));
      return existing;
    }
    return manifest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Build the canonical settings record for an imported package. */
export function recordForPackage(manifest: ExpertPackManifestV2, ref?: string): CanonicalExpertRecord {
  const provenance = manifest.provenance;
  if (manifest.origin !== "package" || provenance.collection !== "mimeographs" ||
      provenance.slug === undefined || provenance.revision === undefined || manifest.id !== provenance.slug)
    throw new Error("expert-ai: invalid expert manifest");
  const binding = {
    source: "mimeographs",
    slug: provenance.slug,
    revision: provenance.revision,
    ref: ref ?? provenance.revision,
  } as const;
  validatePackageLocation(binding);
  if (!validPackageRef(binding.ref))
    throw new Error("expert-ai: invalid expert package; a branch or tag is required");
  return normalizeRecord({
    id: manifest.id,
    name: manifest.name,
    ...(manifest.title === undefined ? {} : { title: manifest.title }),
    description: manifest.description,
    category: manifest.category,
    tags: [...manifest.tags],
    source: { ...manifest.source },
    persona: "",
    origin: { kind: "package", ...binding },
    toolFilter: ["read_expert_reference"],
    enabled: true,
  });
}
