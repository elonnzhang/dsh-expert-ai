import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPERT_TITLE, MAX_EXPERT_TITLE_LENGTH } from "../src/constants.js";

const patch = readFileSync(resolve(import.meta.dirname, "..", "cordis.patch.yml"), "utf8");

const xingtu = patch
  .split(/^ {10}- id: /m)
  .slice(1)
  .filter((block) => block.includes("agent: experts/xingtu/"))
  .map((block) => ({ id: block.slice(0, block.indexOf("\n")), block }));

const recordIds = patch
  .split(/^ {10}- id: /m)
  .slice(1)
  .map((block) => block.slice(0, block.indexOf("\n")));

describe("星途 experts in the bundle patch", () => {
  it("ships only the nine experts, with no scaffold examples left", () => {
    expect(recordIds).toHaveLength(9);
    expect(recordIds).not.toContain("startup-mentor");
    expect(recordIds).not.toContain("research-guide");
  });

  it("ships the nine experts, each bound to the agent file of its own id", () => {
    expect(xingtu).toHaveLength(9);
    for (const { id, block } of xingtu)
      expect(block, id).toMatch(new RegExp(`^ {12}agent: experts/xingtu/${id}/AGENTS\\.md$`, "m"));
  });

  it("gives each one a title of its own", () => {
    const titles = xingtu.map(({ block }) => /^ {12}title: (.+)$/m.exec(block)?.[1]?.trim() ?? "");
    for (const title of titles) {
      expect(title).not.toBe("");
      expect(title).not.toBe(DEFAULT_EXPERT_TITLE);
      expect(title.length).toBeLessThanOrEqual(MAX_EXPERT_TITLE_LENGTH);
    }
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("declares public material and carries no photo", () => {
    for (const { id, block } of xingtu) {
      expect(block, id).toMatch(/^ {12}source:\n {14}kind: public$/m);
      expect(block, id).not.toMatch(/^ {12}avatar:/m);
    }
  });
});
