import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  importMimeograph,
  loadExpertCatalog,
  loadExpertPackage,
  packageAgentBinding,
  readExpertReference,
  readPackageIdentity,
  recordForPackage,
  resolveRevision,
  sha256,
  validatePackageBinding,
} from "../src/host/expert-packages.js";
import { expertAiHome, identityFor } from "../src/host/identity.js";
import { validateSettings } from "../src/host/index.js";
import type { ExpertPackageBinding, ExpertPackageManifest } from "../src/expert-types.js";
import { packageBinding, packageFetcher } from "./expert-fixture.js";

const roots: string[] = [];
async function root() {
  const value = await mkdtemp(join(tmpdir(), "expert-package-test-"));
  roots.push(value);
  return value;
}
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const IDENTITY = "# Test method\nSeparate evidence from assumptions.\n";

/** Write the package an earlier import left on disk, with a manifest over the given files. */
async function writePackage(
  stateDir: string,
  binding: ExpertPackageBinding,
  files: Record<string, string> = {
    "AGENTS.md": IDENTITY,
    "SKILL.md": "Read references/frameworks.md.",
    LICENSE: "MIT License",
  },
) {
  const directory = dirname(join(expertAiHome(process.env, stateDir), packageAgentBinding(binding)));
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
    expect(manifest).toMatchObject({ ...packageBinding, sourceType: "public-method" });
    expect(manifest).not.toHaveProperty("reviewStatus");
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    for (const [url] of fetcher.mock.calls) {
      expect(String(url)).toContain(`/${packageBinding.revision}/`);
      expect(String(url)).not.toMatch(/avatar|_workspace/);
    }
    const record = recordForPackage(manifest, "main");
    expect(() => { validateSettings({ records: [record] }) }).not.toThrow();
    expect(record.agent).toBe(packageAgentBinding(packageBinding));
    expect(await identityFor(record, stateDir)).toContain("Separate evidence");
    const reference = await readExpertReference(record, "references/frameworks.md", stateDir, 10);
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
    await expect(readFile(join(expertAiHome(process.env, stateDir), packageAgentBinding(packageBinding))))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects modified identity and undeclared or escaping reference files", async () => {
    const stateDir = await root();
    const record = recordForPackage(await importMimeograph(packageBinding, stateDir, packageFetcher()), "main");
    await expect(readExpertReference(record, "../settings.yaml", stateDir)).rejects.toThrow(/references/);
    await expect(readExpertReference(record, "references/unknown.md", stateDir)).rejects.toThrow(/manifest/);
    const identity = join(expertAiHome(process.env, stateDir), record.agent!);
    await writeFile(identity, "tampered identity");
    await expect(identityFor(record, stateDir)).rejects.toThrow(/size changed|integrity/);
    await expect(importMimeograph(packageBinding, stateDir, packageFetcher())).rejects.toThrow(/size changed|integrity/);
    const reference = join(dirname(identity), "references/frameworks.md");
    await rm(reference);
    const outside = join(stateDir, "outside.md");
    await writeFile(outside, "private");
    await symlink(outside, reference);
    await expect(readExpertReference(record, "references/frameworks.md", stateDir)).rejects.toThrow(/escapes/);
  });

  it("handles concurrent imports atomically", async () => {
    const stateDir = await root();
    const manifests = await Promise.all([
      importMimeograph(packageBinding, stateDir, packageFetcher()),
      importMimeograph(packageBinding, stateDir, packageFetcher()),
    ]);
    expect(manifests[0]).toEqual(manifests[1]);
    const parent = dirname(dirname(join(expertAiHome(process.env, stateDir), packageAgentBinding(packageBinding))));
    expect(await readdir(parent)).toEqual([packageBinding.slug]);
  });

  it("records the branch or tag a package was imported from", async () => {
    const manifest = await importMimeograph(packageBinding, await root(), packageFetcher());
    const record = recordForPackage(manifest, "main");
    expect(record.expertPackage).toEqual({ ...packageBinding, ref: "main" });
    expect(recordForPackage(manifest).expertPackage?.ref).toBe(manifest.revision);
    expect(record.agent).toBe(packageAgentBinding(packageBinding));
    expect(() => { validateSettings({ records: [record] }) }).not.toThrow();
    expect(() => recordForPackage(manifest, "../main")).toThrow(/branch or tag/);
    const { ref: _ref, ...commitOnly } = record.expertPackage!;
    expect(() => { validateSettings({ records: [{ ...record, expertPackage: commitOnly as typeof record.expertPackage }] }) })
      .not.toThrow();
    expect(() => {
      validateSettings({ records: [{ ...record, expertPackage: { ...commitOnly, ref: "../main" } }] });
    }).toThrow(/branch or tag/);
  });

  it("does not relabel a different identity as the imported package", async () => {
    const manifest = await importMimeograph(packageBinding, await root(), packageFetcher());
    expect(() => {
      validateSettings({ records: [{ ...recordForPackage(manifest, "main"), agent: "/tmp/other.md" }] });
    }).toThrow(/immutable package/);
  });

  it("keeps a portable binding per commit and slug", () => {
    expect(packageAgentBinding(packageBinding)).toBe(
      `.expert-packages/mimeographs/${packageBinding.revision}/${packageBinding.slug}/AGENTS.md`,
    );
  });

  it("rejects a package without a full commit and a branch name", () => {
    expect(() => { validatePackageBinding({ source: "mimeographs", slug: "../outside", revision: packageBinding.revision, ref: "main" }) })
      .toThrow(/invalid expert package/);
    expect(() => { validatePackageBinding({ ...packageBinding, revision: "main", ref: "main" }) }).toThrow(/commit SHA/);
    expect(() => { validatePackageBinding({ ...packageBinding, ref: "../main" }) }).toThrow(/branch or tag/);
    expect(() => { validatePackageBinding({ ...packageBinding, ref: "feature/" }) }).toThrow(/branch or tag/);
  });

  it("reads the verified identity of a stored package", async () => {
    const stateDir = await root();
    await writePackage(stateDir, packageBinding);
    // A package identity is the file as stored, before `identityFor` trims it.
    expect(await readPackageIdentity(packageBinding, stateDir)).toBe(IDENTITY);
    expect(await identityFor({
      id: "test-expert", name: "Test", description: "Test", category: "science", tags: [], persona: "",
      agent: packageAgentBinding(packageBinding), expertPackage: { ...packageBinding, ref: "main" }, enabled: true,
    }, stateDir)).toBe(IDENTITY.trim());
  });

  it("rejects a modified identity", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding);
    // Keep the size so the hash is the check that fails.
    await writeFile(join(directory, "AGENTS.md"), IDENTITY.replace("Separate", "Seperate"));
    await expect(readPackageIdentity(packageBinding, stateDir)).rejects.toThrow(/integrity/);
  });

  it("rejects a package whose manifest does not match its binding", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding);
    const path = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as ExpertPackageManifest;
    await writeFile(path, JSON.stringify({ ...manifest, slug: "other-expert" }));
    await expect(loadExpertPackage(packageBinding, stateDir)).rejects.toThrow(/invalid expert manifest/);
  });

  it("ignores a reviewStatus left by an older package manifest", async () => {
    const stateDir = await root();
    const directory = await writePackage(stateDir, packageBinding);
    const path = join(directory, "manifest.json");
    const manifest = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...manifest, reviewStatus: "unreviewed" }));
    const loaded = await loadExpertPackage(packageBinding, stateDir);
    expect(loaded).not.toHaveProperty("reviewStatus");
    expect(await readPackageIdentity(packageBinding, stateDir)).toBe(IDENTITY);
  });

  it("rejects a symlinked package directory", async () => {
    const stateDir = await root();
    const outside = await root();
    await writePackage(outside, packageBinding);
    const directory = dirname(join(expertAiHome(process.env, stateDir), packageAgentBinding(packageBinding)));
    await mkdir(dirname(directory), { recursive: true });
    await symlink(dirname(join(expertAiHome(process.env, outside), packageAgentBinding(packageBinding))), directory);
    await expect(loadExpertPackage(packageBinding, stateDir)).rejects.toThrow(/symlinked/);
  });
});
