import { describe, expect, it } from "vitest";
import { en, zh } from "../src/client/locales.js";

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!).sort();
}

describe("expert-ai UI dictionaries", () => {
  it("keeps English and Chinese keys and placeholders aligned", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]));
    }
  });
});
