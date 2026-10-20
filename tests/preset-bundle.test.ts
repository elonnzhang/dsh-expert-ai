import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDevPatch } from "../scripts/render-dev-patch.mjs";
import { EXPERT_AI_NAMESPACE } from "../src/constants.js";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  dsh: { bundle: { patch: string[] } };
  files: string[];
};
const entries = { host: "/dev/lib/index.js", client: "/dev/lib/client.js" };

describe("expert-ai bundle", () => {
  it("ships only the identity and conversation composition", () => {
    expect(manifest.dsh.bundle.patch).toEqual(["./cordis.patch.yml"]);
    expect(manifest.files).not.toContain("expert-ai-mode.patch.yml");
  });

  it("keys the overlay Host entry by the id the Client reads its settings form with", () => {
    expect(renderDevPatch(entries)).toContain(`    - id: ${EXPERT_AI_NAMESPACE}\n      name: '/dev/lib/index.js'`);
  });

  it("overlays exactly the Host and Client halves", () => {
    const overlay = renderDevPatch(entries);
    expect(overlay).toContain("name: '/dev/lib/client.js'");
    expect(overlay).not.toContain("config");
    expect(overlay).not.toContain("preset-");
  });
});
