import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadExpertPackage,
  packageAgentBinding,
  readPackageIdentity,
  sha256,
  validatePackageBinding,
} from "../src/host/expert-packages.js";
import { expertAiHome, identityFor } from "../src/host/identity.js";
import type { ExpertPackageBinding, ExpertPackageManifest } from "../src/expert-types.js";
import { packageBinding } from "./expert-fixture.js";

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
  files: Record<string, string> = { "AGENTS.md": IDENTITY },
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
    reviewStatus: "unreviewed",
    files: Object.entries(files).map(([path, text]) => ({ path, sha256: sha256(text), bytes: Buffer.byteLength(text) })),
  };
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return directory;
}

describe("versioned expert packages", () => {
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
      id: "mimeograph-test-expert", name: "Test", description: "Test", category: "science", tags: [], persona: "",
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
