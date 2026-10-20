import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderDevPatch } from "../scripts/render-dev-patch.mjs";
import { DIGITAL_LIFE_NAMESPACE } from "../src/constants.js";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  dsh: { bundle: { patch: string[] } };
  files: string[];
};
const preset = readFileSync(resolve(root, "digital-life-mode.patch.yml"), "utf8");
const entries = { host: "/dev/lib/index.js", client: "/dev/lib/client.js", preset };

describe("digital-life preset bundle", () => {
  it("ships the named composition as an opt-in patch, outside the installed bundle", () => {
    expect(manifest.dsh.bundle.patch).toEqual(["./cordis.patch.yml"]);
    expect(manifest.files).toContain("digital-life-mode.patch.yml");
    expect(preset).toContain("name: '@deepseek-ai/dsh-agent-preset'");
    expect(preset).toContain("id: digital-life-mode");
    expect(preset).toContain("name: 数字生命模式");
    expect(preset).toContain("name: '@deepseek-ai/dsh-persona'");
  });

  it("keeps the development overlay identity-only by default", () => {
    const overlay = renderDevPatch({ ...entries, conversation: false });
    expect(overlay).toContain("name: '/dev/lib/index.js'");
    expect(overlay).toContain("name: '/dev/lib/client.js'");
    expect(overlay).not.toContain("features");
    expect(overlay).not.toContain("preset-digital-life-mode");
  });

  it("adds the conversation feature and the preset to the overlay on request", () => {
    const overlay = renderDevPatch({ ...entries, conversation: true });
    expect(overlay).toContain("      config:\n        features: [identity, conversation]\n    - id: dev-digital-life-client");
    expect(overlay.endsWith(preset)).toBe(true);
  });

  it("keys the overlay Host entry by the id the Client reads its settings form with", () => {
    for (const conversation of [false, true])
      expect(renderDevPatch({ ...entries, conversation })).toContain(`    - id: ${DIGITAL_LIFE_NAMESPACE}\n      name: '/dev/lib/index.js'`);
  });
});
