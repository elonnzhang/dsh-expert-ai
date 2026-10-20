import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importMimeograph, loadExpertCatalog, MIMEOGRAPHS_REVISION, readExpertReference, recordForPackage } from "../lib/index.js";

const stateDir = await mkdtemp(join(tmpdir(), "expert-ai-smoke-"));
try {
  const catalog = await loadExpertCatalog();
  assert.ok(catalog.some((entry) => entry.slug === "andrej-karpathy"));
  const binding = { source: "mimeographs", slug: "andrej-karpathy", revision: MIMEOGRAPHS_REVISION };
  const manifest = await importMimeograph(binding, stateDir);
  const reference = await readExpertReference(recordForPackage(manifest, "main"), "references/frameworks.md", stateDir);
  assert.ok(reference.text.length > 0);
  assert.ok(manifest.files.some((file) => file.path === "LICENSE"));
  const cached = await importMimeograph(binding, stateDir, () => { throw new Error("Cached import must not use the network"); });
  assert.deepEqual(cached, manifest);
  console.log(JSON.stringify({
    check: "upstream import and local integrity; no model evaluation",
    catalogCount: catalog.length,
    revision: manifest.revision,
    files: manifest.files.length,
    referenceCharacters: reference.text.length,
    offlineReimport: true,
  }, null, 2));
} finally {
  await rm(stateDir, { recursive: true, force: true });
}
