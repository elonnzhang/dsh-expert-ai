import { mkdtemp, readFile, rm, writeFile, symlink, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importMimeograph, loadExpertCatalog, packageAgentBinding, readExpertReference, recordForPackage, resolveRevision } from "../src/host/expert-packages.js";
import { expertAiHome, identityFor, reconcileIdentities } from "../src/host/identity.js";
import { validateSettings } from "../src/host/index.js";
import { packageBinding, packageFetcher } from "./expert-fixture.js";

const roots: string[] = [];
async function root() { const value = await mkdtemp(join(tmpdir(), "expert-package-test-")); roots.push(value); return value; }
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("versioned expert packages", () => {
  it("imports only declared text and the license, with hashes and portable binding", async () => {
    const stateDir = await root();
    const fetcher = packageFetcher();
    const manifest = await importMimeograph(packageBinding, stateDir, fetcher);
    expect(manifest).toMatchObject({ ...packageBinding, sourceType: "public-method", reviewStatus: "unreviewed" });
    expect(manifest.files).toHaveLength(6);
    expect(manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    for (const [url] of fetcher.mock.calls) {
      expect(String(url)).toContain(`/${packageBinding.revision}/`);
      expect(String(url)).not.toMatch(/avatar|_workspace/);
    }
    const record = recordForPackage(manifest, "main");
    expect(() => validateSettings({ records: [record] })).not.toThrow();
    expect(record.agent).toBe(packageAgentBinding(packageBinding));
    expect(await identityFor(record, stateDir)).toContain("Separate evidence");
    const reference = await readExpertReference(record, "references/frameworks.md", stateDir, 10);
    expect(reference.text).toHaveLength(10);
    expect(reference.truncated).toBe(true);
    expect(reference.id).toContain(packageBinding.revision);
    expect(reference.sourceUrl).toContain("/blob/");
    await reconcileIdentities([record], [], stateDir);
    expect(await identityFor(record, stateDir)).toContain("Separate evidence");
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
    await expect(loadExpertCatalog(packageBinding.revision, packageFetcher({ references: ["references/../../private.md"] }))).rejects.toThrow(/reference list/);
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
    await expect(importMimeograph(packageBinding, stateDir, packageFetcher({ fail: "mimeographs/test-expert/SKILL.md" }))).rejects.toThrow(/download failed/);
    await expect(readFile(join(expertAiHome(process.env, stateDir), packageAgentBinding(packageBinding)))).rejects.toMatchObject({ code: "ENOENT" });
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
    const manifests = await Promise.all([importMimeograph(packageBinding, stateDir, packageFetcher()), importMimeograph(packageBinding, stateDir, packageFetcher())]);
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
    expect(() => validateSettings({ records: [record] })).not.toThrow();
    expect(() => recordForPackage(manifest, "../main")).toThrow(/branch or tag/);
    const { ref: _ref, ...commitOnly } = record.expertPackage!;
    expect(() => validateSettings({ records: [{ ...record, expertPackage: commitOnly as typeof record.expertPackage }] })).not.toThrow();
    expect(() => validateSettings({ records: [{ ...record, expertPackage: { ...commitOnly, ref: "../main" } }] })).toThrow(/branch or tag/);
  });

  it("does not relabel a different identity as the imported package", async () => {
    const manifest = await importMimeograph(packageBinding, await root(), packageFetcher());
    expect(() => validateSettings({ records: [{ ...recordForPackage(manifest, "main"), agent: "/tmp/other.md" }] })).toThrow(/immutable package/);
  });
});
