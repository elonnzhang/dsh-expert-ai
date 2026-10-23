import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importMimeograph,
  loadExpertCatalog,
  listPackReferences,
  loadPackManifest,
  packLocation,
  readPackFile,
  readPackIdentity,
  readPackReference,
  recordForPackage,
  resolveRevision,
} from "../src/host/identity/index.js";
import type { PackLocation } from "../src/host/identity/index.js";
import { expertAiHome, identityFor } from "../src/host/identity/index.js";
import { legacyPackageAgentPath, normalizeRecord, packageAgentPath, settingsProblems } from "../src/record-model.js";
import type { ExpertPackageBinding, ExpertPackageLocation, ExpertPackageManifest, ExpertPackManifestV2 } from "../src/expert-types.js";
import { packageBinding, packageFetcher } from "./expert-fixture.js";

const bundled = vi.hoisted(() => ({ packageRoot: undefined as string | undefined }));
vi.mock("../src/host/identity/paths.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/host/identity/paths.js")>();
  return { ...actual, get PLUGIN_PACKAGE_ROOT() { return bundled.packageRoot ?? actual.PLUGIN_PACKAGE_ROOT; } };
});

const packageOrigin = { kind: "package", ...packageBinding, ref: "main" } as const;
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
async function loadPackage(binding: ExpertPackageLocation, stateDir?: string): Promise<ExpertPackManifestV2> {
  const origin = { kind: "package" as const, ...binding, ref: "main" };
  return loadPackManifest(packLocation(origin, stateDir), origin);
}

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "expert-package-test-"));
  roots.push(value);
  return value;
}
afterEach(async () => {
  bundled.packageRoot = undefined;
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const IDENTITY = "# Test method\nSeparate evidence from assumptions.\n";

/** Write the package an earlier import left on disk, with a manifest over the given files. */
async function writePackage(
  stateDir: string,
  binding: ExpertPackageLocation,
  files: Record<string, string> = {
    "AGENTS.md": IDENTITY,
    "SKILL.md": "Read references/frameworks.md.",
    LICENSE: "MIT License",
  },
) {
  const directory = packLocation({ kind: "package", ...binding, ref: "main" }, stateDir).root;
  await mkdir(directory, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text);
  }
  const manifest: ExpertPackageManifest = {
    ...binding,
    schemaVersion: 1,
    name: "Test expert",
    description: "Analyze evidence",
    category: "science",
    importedAt: "2026-10-01T00:00:00.000Z",
    sourceType: "public-method",
    files: Object.entries(files).map(([path, text]) => ({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })),
  };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return directory;
}

describe("versioned expert packages", () => {
  it("imports only declared text and the license, with hashes and portable binding", async () => {
    const stateDir = await root();
    const fetcher = packageFetcher();
    const manifest = await importMimeograph(packageBinding, stateDir, fetcher);
    expect(manifest).toMatchObject({
      schemaVersion: 2, origin: "package", id: packageBinding.slug,
      name: "Test expert", description: "Analyze evidence", category: "science",
      tags: ["mimeographs", "public-method"], source: { kind: "public" },
      provenance: { collection: "mimeographs", slug: packageBinding.slug, revision: packageBinding.revision },
    });
    const stored = JSON.parse(await readFile(join(packLocation(packageOrigin, stateDir).root, "manifest.json"), "utf8"));
    expect(stored).toEqual(manifest);
    expect(stored).not.toHaveProperty("sourceType");
    expect(manifest).not.toHaveProperty("reviewStatus");
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    for (const [url, options] of fetcher.mock.calls) {
      expect(String(url)).toContain(`/${packageBinding.revision}/`);
      expect(String(url)).not.toMatch(/avatar|_workspace/);
      expect(options).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
    }
    const record = recordForPackage(manifest, "main");
    expect(settingsProblems([record])).toEqual([]);
    expect(record.origin).toEqual(packageOrigin);
    expect(record).not.toHaveProperty("agent");
    expect(record).not.toHaveProperty("expertPackage");
    expect(await identityFor(record, stateDir)).toContain("Separate evidence");
    const reference = await readPackReference(record, "references/frameworks.md", stateDir, 10);
    expect(reference.text).toHaveLength(10);
    expect(reference.truncated).toBe(true);
    expect(reference.id).toContain(packageBinding.revision);
    expect(reference.sourceUrl).toContain("/blob/");
  });

  it("reuses immutable packages offline and preserves the original import date", async () => {
    const stateDir = await root();
    const first = await importMimeograph(packageBinding, stateDir, packageFetcher());
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    expect(await importMimeograph(packageBinding, stateDir, offline)).toEqual(first);
    expect(offline).not.toHaveBeenCalled();
  });

  it("rejects branch names and traversal before downloading", async () => {
    const fetcher = packageFetcher();
    await expect(importMimeograph({ ...packageBinding, revision: "main" }, await root(), fetcher)).rejects.toThrow(/commit SHA/);
    await expect(importMimeograph({ ...packageBinding, slug: "../outside" }, await root(), fetcher)).rejects.toThrow(/invalid expert/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(loadExpertCatalog(packageBinding.revision, packageFetcher({ references: ["references/../../private.md"] })))
      .rejects.toThrow(/reference list/);
  });

  it("resolves branches and tags to a full commit SHA", async () => {
    const sha = packageBinding.revision;
    const lookup = vi.fn<typeof fetch>(async (input) =>
      String(input).endsWith("/commits/v1.0") ? new Response(`${sha.toUpperCase()}\n`) : new Response("missing", { status: 422 }));
    expect(await resolveRevision(" v1.0 ", lookup)).toEqual({ revision: sha, cached: false });
    expect(lookup.mock.calls[0]?.[0]).toBe("https://api.github.com/repos/K-Dense-AI/mimeographs/commits/v1.0");
    await expect(resolveRevision("nope", lookup)).rejects.toThrow(/version not found/);
    const untouched = vi.fn<typeof fetch>();
    await expect(resolveRevision("../main", untouched)).rejects.toThrow(/invalid version/);
    await expect(resolveRevision("feature/", untouched)).rejects.toThrow(/invalid version/);
    expect(untouched).not.toHaveBeenCalled();
    const bogus = vi.fn<typeof fetch>(async () => new Response("<html>"));
    await expect(resolveRevision("main", bogus)).rejects.toThrow(/invalid commit/);
  });

  it("resolves a ref through the commit feed when the REST API is rate limited", async () => {
    const sha = packageBinding.revision;
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.startsWith("https://api.github.com/")) return new Response("rate limited", { status: 403 });
      expect(url).toBe("https://github.com/K-Dense-AI/mimeographs/commits/main.atom");
      return new Response(`<feed><entry><id>tag:github.com,2008:Grit::Commit/${sha.toUpperCase()}</id></entry></feed>`);
    });
    expect(await resolveRevision("main", fetcher)).toEqual({ revision: sha, cached: false });
  });

  it("falls back to the last resolved commit when GitHub is unreachable", async () => {
    const home = await root();
    const sha = packageBinding.revision;
    await resolveRevision("main", vi.fn<typeof fetch>(async () => new Response(sha)), home);
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    expect(await resolveRevision("main", offline, home)).toEqual({ revision: sha, cached: true });
    const limited = vi.fn<typeof fetch>(async () => new Response("rate limited", { status: 403 }));
    expect(await resolveRevision("main", limited, home)).toEqual({ revision: sha, cached: true });
    await expect(resolveRevision("other", offline, home)).rejects.toThrow(/offline/);
    await expect(resolveRevision("main", offline)).rejects.toThrow(/offline/);
  });

  it("caches the catalog per commit and reuses it offline", async () => {
    const home = await root();
    const online = packageFetcher();
    const first = await loadExpertCatalog(packageBinding.revision, online, home);
    expect(online).toHaveBeenCalledTimes(1);
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    expect(await loadExpertCatalog(packageBinding.revision, offline, home)).toEqual(first);
    expect(offline).not.toHaveBeenCalled();
    const path = join(home, ".expert-packages", "mimeographs", "catalogs", `${packageBinding.revision}.json`);
    await writeFile(path, "{broken");
    const refetch = packageFetcher();
    expect(await loadExpertCatalog(packageBinding.revision, refetch, home)).toEqual(first);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await readFile(path, "utf8"))).toHaveProperty("experts");
    await expect(loadExpertCatalog("main", offline, home)).rejects.toThrow(/commit SHA/);
  });

  it("does not leave a package behind after a failed download", async () => {
    const stateDir = await root();
    await expect(importMimeograph(packageBinding, stateDir, packageFetcher({ fail: "mimeographs/test-expert/SKILL.md" })))
      .rejects.toThrow(/download failed/);
    await expect(readFile(join(expertAiHome(process.env, stateDir), packageAgentPath(packageBinding))))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects modified identity and undeclared or escaping reference files", async () => {
    const stateDir = await root();
    const record = recordForPackage(await importMimeograph(packageBinding, stateDir, packageFetcher()), "main");
    await expect(readPackReference(record, "../settings.yaml", stateDir)).rejects.toThrow(/references/);
    await expect(readPackReference(record, "references/unknown.md", stateDir)).rejects.toThrow(/manifest/);
    const identity = join(packLocation(packageOrigin, stateDir).root, "AGENTS.md");
    await writeFile(identity, "tampered identity");
    await expect(identityFor(record, stateDir)).rejects.toThrow(/size changed|integrity/);
    await expect(importMimeograph(packageBinding, stateDir, packageFetcher())).rejects.toThrow(/size changed|integrity/);
    const reference = join(dirname(identity), "references/frameworks.md");
    await rm(reference);
    const outside = join(stateDir, "outside.md");
    await writeFile(outside, "private");
    await symlink(outside, reference);
    await expect(readPackReference(record, "references/frameworks.md", stateDir)).rejects.toThrow(/escapes/);
  });

  it("handles concurrent imports atomically", async () => {
    const stateDir = await root();
    const manifests = await Promise.all([
      importMimeograph(packageBinding, stateDir, packageFetcher()),
      importMimeograph(packageBinding, stateDir, packageFetcher()),
    ]);
    expect(manifests[0]).toEqual(manifests[1]);
    const parent = dirname(packLocation(packageOrigin, stateDir).root);
    expect(await readdir(parent)).toEqual([packageBinding.slug]);
  });

  it("records the branch or tag a package was imported from", async () => {
    const manifest = await importMimeograph(packageBinding, await root(), packageFetcher());
    const record = recordForPackage(manifest, "main");
    expect(record.origin).toEqual(packageOrigin);
    expect(recordForPackage(manifest).origin).toMatchObject({ ref: manifest.provenance.revision });
    expect(settingsProblems([record])).toEqual([]);
    expect(() => recordForPackage(manifest, "../main")).toThrow(/branch or tag/);
    const commitOnly = normalizeRecord({ ...record, origin: undefined, expertPackage: packageBinding as ExpertPackageBinding });
    expect(commitOnly.origin).toMatchObject({ ref: packageBinding.revision });
    expect(settingsProblems([{ ...record, origin: { ...packageOrigin, ref: "../main" } }])[0]?.message).toMatch(/branch or tag/);
  });

  it("does not relabel a different identity as the imported package", async () => {
    const manifest = await importMimeograph(packageBinding, await root(), packageFetcher());
    const legacy = {
      ...recordForPackage(manifest, "main"), origin: undefined, expertPackage: packageOrigin, agent: "/tmp/other.md",
    };
    expect(settingsProblems([legacy])[0]?.message).toMatch(/immutable package/);
  });

  it("keeps a portable binding per source and slug", () => {
    expect(packageAgentPath(packageBinding)).toBe(
      `mimeographs/${packageBinding.slug}/AGENTS.md`,
    );
  });

  it("imports into source/slug and reuses it without comparing commits", async () => {
    const stateDir = await root();
    const first = await importMimeograph(packageBinding, stateDir, packageFetcher());
    expect(packLocation(packageOrigin, stateDir).root).toBe(
      join(expertAiHome(process.env, stateDir), "mimeographs", packageBinding.slug),
    );
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    const other = { ...packageBinding, revision: "b".repeat(40) };
    expect(await importMimeograph(other, stateDir, offline)).toEqual(first);
    expect(offline).not.toHaveBeenCalled();
    const origin = { kind: "package" as const, ...other, ref: "other" };
    const record = normalizeRecord({ ...recordForPackage(first), origin });
    const reference = await readPackReference(record, "references/frameworks.md", stateDir);
    expect(reference.sourceUrl).toContain(`/blob/${packageBinding.revision}/`);
  });

  it("reads and reuses a legacy commit directory without rewriting it", async () => {
    const stateDir = await root();
    const canonical = await writePackage(stateDir, packageBinding);
    const legacy = dirname(join(expertAiHome(process.env, stateDir), legacyPackageAgentPath(packageBinding)));
    await mkdir(dirname(legacy), { recursive: true });
    await rename(canonical, legacy);
    expect(packLocation(packageOrigin, stateDir).root).toBe(legacy);
    expect(await readPackIdentity(packageOrigin, stateDir)).toBe(IDENTITY.trim());
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    expect((await importMimeograph(packageBinding, stateDir, offline)).id).toBe(packageBinding.slug);
    expect(offline).not.toHaveBeenCalled();
    await expect(lstat(canonical)).rejects.toMatchObject({ code: "ENOENT" });
    expect(settingsProblems([{
      ...recordForPackage(await loadPackage(packageBinding, stateDir)),
      origin: undefined,
      expertPackage: packageOrigin,
      agent: legacyPackageAgentPath(packageBinding),
    }])).toEqual([]);
  });

  it("rejects a package without a full commit and a branch name", () => {
    expect(() => { packLocation({ ...packageOrigin, slug: "../outside" }) })
      .toThrow(/invalid expert package/);
    expect(() => { packLocation({ ...packageOrigin, revision: "main" }) }).toThrow(/commit SHA/);
    expect(() => { packLocation({ ...packageOrigin, ref: "../main" }) }).toThrow(/branch or tag/);
    expect(() => { packLocation({ ...packageOrigin, ref: "feature/" }) }).toThrow(/branch or tag/);
  });

  it("reads the verified identity of a stored package", async () => {
    const stateDir = await root();
    await writePackage(stateDir, packageBinding);
    expect(await readPackIdentity(packageOrigin, stateDir)).toBe(IDENTITY.trim());
    expect(await identityFor(normalizeRecord({
      id: "test-expert", name: "Test", description: "Test", category: "science", tags: [], persona: "",
      agent: packageAgentPath(packageBinding), expertPackage: { ...packageBinding, ref: "main" }, enabled: true,
    }), stateDir)).toBe(IDENTITY.trim());
  });

  it("rejects a modified identity", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding);
    // Keep the size so the hash is the check that fails.
    await writeFile(join(directory, "AGENTS.md"), IDENTITY.replace("Separate", "Seperate"));
    await expect(readPackIdentity(packageOrigin, stateDir)).rejects.toThrow(/integrity/);
  });

  it("rejects a package whose manifest does not match its binding", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding);
    const path = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as ExpertPackageManifest;
    await writeFile(path, JSON.stringify({ ...manifest, slug: "other-expert" }));
    await expect(loadPackage(packageBinding, stateDir)).rejects.toThrow(/invalid expert manifest/);
  });

  it("ignores a reviewStatus left by an older package manifest", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding);
    const path = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...manifest, reviewStatus: "unreviewed" }));
    const loaded = await loadPackage(packageBinding, stateDir);
    expect(loaded).not.toHaveProperty("reviewStatus");
    expect(await readPackIdentity(packageOrigin, stateDir)).toBe(IDENTITY.trim());
  });

  it("rejects a symlinked package directory", async () => {
    const stateDir = await root();
    const outside = await root();
    await writePackage(outside, packageBinding);
    const directory = packLocation(packageOrigin, stateDir).root;
    await mkdir(dirname(directory), { recursive: true });
    await symlink(packLocation(packageOrigin, outside).root, directory);
    await expect(loadPackage(packageBinding, stateDir)).rejects.toThrow(/symlinked/);
  });

  it("upgrades v1 manifests in memory and reuses their files and original import date offline", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding);
    const path = join(directory, "manifest.json");
    const original = await readFile(path, "utf8");
    const loaded = await loadPackage(packageBinding, stateDir);
    expect(loaded).toMatchObject({
      schemaVersion: 2, origin: "package", id: packageBinding.slug, source: { kind: "public" },
      tags: ["mimeographs", "public-method"],
      provenance: {
        collection: "mimeographs", slug: packageBinding.slug,
        revision: packageBinding.revision, importedAt: "2026-10-01T00:00:00.000Z",
      },
    });
    expect(loaded).not.toHaveProperty("sourceType");
    const offline = vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")));
    expect(await importMimeograph(packageBinding, stateDir, offline)).toEqual(loaded);
    expect(offline).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readPackFile(packLocation(packageOrigin, stateDir), loaded, "AGENTS.md")).toBe(IDENTITY);
  });

  it("takes imported record metadata from the manifest while keeping the body in the pack", async () => {
    const manifest = await importMimeograph(packageBinding, await root(), packageFetcher());
    const record = recordForPackage({
      ...manifest,
      name: "Method expert",
      title: "Evidence",
      description: "Updated summary",
      tags: ["analysis"],
      source: { kind: "organization", note: "Approved material" },
    }, "v1");
    expect(record).toEqual(normalizeRecord({
      id: packageBinding.slug,
      name: "Method expert", title: "Evidence", description: "Updated summary", category: "science",
      tags: ["analysis"], source: { kind: "organization", note: "Approved material" },
      origin: { ...packageOrigin, ref: "v1" }, persona: "", enabled: true, toolFilter: ["read_expert_reference"],
    }));
    record.tags.push("local");
    expect(manifest.tags).toEqual(["mimeographs", "public-method"]);
  });

  it("rejects v2 provenance that does not match the requested origin", async () => {
    const stateDir = await root();
    const manifest = await importMimeograph(packageBinding, stateDir, packageFetcher());
    const path = join(packLocation(packageOrigin, stateDir).root, "manifest.json");
    for (const invalid of [
      { ...manifest, id: "another-expert" },
      { ...manifest, origin: "bundled" },
      { ...manifest, provenance: { ...manifest.provenance, revision: "invalid-sha" } },
      { ...manifest, provenance: { ...manifest.provenance, collection: "another-source" } },
    ]) {
      await writeFile(path, JSON.stringify(invalid));
      await expect(loadPackage(packageBinding, stateDir)).rejects.toThrow(/invalid expert manifest/);
    }
  });

  it("lists only declared references with the pinned package revision", async () => {
    const stateDir = await root();
    const manifest = await importMimeograph(packageBinding, stateDir, packageFetcher());
    expect(await listPackReferences(packageOrigin, stateDir)).toEqual({
      revision: packageBinding.revision,
      files: manifest.files.filter(({ path }) => path.startsWith("references/")),
    });
    const record = recordForPackage(manifest);
    for (const path of ["AGENTS.md", "references/a/b.md", "references/../private.md", "references/frameworks.md/extra"])
      await expect(readPackReference(record, path, stateDir)).rejects.toThrow(/references/);
    await expect(readPackReference(normalizeRecord({ ...record, origin: { kind: "managed" } }), "references/frameworks.md", stateDir))
      .rejects.toThrow(/no reference package/);
  });

  it("refuses to overwrite an incomplete existing package", async () => {
    const stateDir = await root();
    const directory = packLocation(packageOrigin, stateDir).root;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "AGENTS.md"), "Keep this partial import.");
    const fetcher = packageFetcher();
    await expect(importMimeograph(packageBinding, stateDir, fetcher)).rejects.toThrow(/incomplete.*refusing to overwrite/);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toBe("Keep this partial import.");
  });

  it("enforces the 256 KiB download and manifest limits", async () => {
    const stateDir = await root();
    const fetcher = packageFetcher({ files: { "mimeographs/test-expert/AGENTS.md": "x".repeat(256 * 1024 + 1) } });
    await expect(importMimeograph(packageBinding, stateDir, fetcher)).rejects.toThrow(/download exceeds 262144 bytes/);
    await expect(readFile(join(packLocation(packageOrigin, stateDir).root, "manifest.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
    const directory = await writePackage(stateDir, packageBinding);
    await writeFile(join(directory, "manifest.json"), " ".repeat(256 * 1024 + 1));
    await expect(loadPackage(packageBinding, stateDir)).rejects.toThrow(/manifest is too large/);
  });

  it("rejects a symlinked manifest and a symlink to another file inside the same pack", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding, {
      "AGENTS.md": IDENTITY, "SKILL.md": "Skill", LICENSE: "License", "references/evidence.md": IDENTITY,
    });
    const manifest = await loadPackage(packageBinding, stateDir);
    await rm(join(directory, "references/evidence.md"));
    await symlink(join(directory, "AGENTS.md"), join(directory, "references/evidence.md"));
    await expect(readPackFile(packLocation(packageOrigin, stateDir), manifest, "references/evidence.md"))
      .rejects.toThrow(/symlinked/);
    const path = join(directory, "manifest.json");
    const original = await readFile(path, "utf8");
    const outside = join(stateDir, "outside-manifest.json");
    await writeFile(outside, original);
    await rm(path);
    await symlink(outside, path);
    await expect(loadPackage(packageBinding, stateDir)).rejects.toThrow(/symlinked expert manifests/);
  });

  it("verifies a bundled pack copy before reading its identity", async () => {
    const directory = join(await root(), "clq");
    await cp(resolve(import.meta.dirname, "../experts/xingtu/clq"), directory, { recursive: true });
    const origin = { kind: "bundled", path: "experts/xingtu/clq" } as const;
    const location: PackLocation = { kind: "bundled", root: directory };
    const manifest = await loadPackManifest(location, origin);
    const original = await readPackFile(location, manifest, "AGENTS.md");
    expect(original).toContain("# 陈立泉");
    const tampered = original.replace("# ", "! ");
    expect(Buffer.byteLength(tampered)).toBe(Buffer.byteLength(original));
    await writeFile(join(directory, "AGENTS.md"), tampered);
    await expect(readPackFile(location, manifest, "AGENTS.md")).rejects.toThrow(/integrity/);
    await expect(loadPackManifest(location, { kind: "bundled", path: "experts/xingtu/lh" }))
      .rejects.toThrow(/invalid expert manifest/);
  });

  it.each([
    "experts/ELON",
    "experts/xingtu/ELON",
    "experts/xingtu/team/ELON",
  ])("reads a bundled pack at any depth with a case-insensitive folder id: %s", async (path) => {
    const temporary = await root();
    const source = resolve(import.meta.dirname, "../experts/xingtu/clq");
    const directory = join(temporary, path);
    await mkdir(dirname(directory), { recursive: true });
    await cp(source, directory, { recursive: true });
    // Folder names may differ in case; the manifest id stays the canonical lowercase record id.
    const manifestPath = join(directory, "manifest.json");
    const raw = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...raw, id: "elon" }));
    const origin = { kind: "bundled", path } as const;
    const location: PackLocation = { kind: "bundled", root: directory };
    const manifest = await loadPackManifest(location, origin);
    expect(manifest.id).toBe("elon");
    bundled.packageRoot = temporary;
    expect(await readPackIdentity(origin)).toContain("# 陈立泉");
  });

  it("reads a bundled reference from a temporary pack and omits its sourceUrl", async () => {
    const temporary = await root();
    const directory = join(temporary, "experts/xingtu/clq");
    await cp(resolve(import.meta.dirname, "../experts/xingtu/clq"), directory, { recursive: true });
    const body = "# Local reference\nUse only the declared material.";
    const path = "references/evidence.md";
    await mkdir(join(directory, "references"));
    await writeFile(join(directory, path), body);
    const manifestPath = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ExpertPackManifestV2;
    const reference = { path, sha256: sha256(body), bytes: Buffer.byteLength(body) };
    manifest.files.push(reference);
    await writeFile(manifestPath, JSON.stringify(manifest));
    bundled.packageRoot = temporary;
    const record = normalizeRecord({
      id: "local-clq", name: "Record metadata", description: "Record summary", category: "science", tags: [],
      persona: "", origin: { kind: "bundled", path: "experts/xingtu/clq" }, enabled: true,
    });
    expect(await listPackReferences(record.origin as Extract<typeof record.origin, { kind: "bundled" }>)).toEqual({ files: [reference] });
    const read = await readPackReference(record, path, undefined, 12);
    expect(read).toEqual({
      id: `local-clq@bundled:${path}`, expertId: "local-clq", path, revision: "bundled",
      sha256: reference.sha256, text: body.slice(0, 12), truncated: true,
    });
    expect(read).not.toHaveProperty("sourceUrl");
    manifest.provenance.revision = packageBinding.revision;
    await writeFile(manifestPath, JSON.stringify(manifest));
    expect((await readPackReference(record, path)).id).toBe(`local-clq@${packageBinding.revision}:${path}`);
  });
});
