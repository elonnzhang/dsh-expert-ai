import { describe, expect, it } from "vitest";
import { mentionCandidates } from "../src/client/mentions.js";

const experts = [
  { id: "a", name: "Alpha", description: "Stats", tags: ["data"] },
  { id: "b", name: "Beta", description: "Energy storage", tags: ["电池"] },
];

describe("@ candidates", () => {
  it("lists every expert for an empty query", () => {
    expect(mentionCandidates(experts, "")).toEqual([
      { name: "a", description: "Alpha · Stats" },
      { name: "b", description: "Beta · Energy storage" },
    ]);
  });

  it("matches the id, name, description and tags case-insensitively", () => {
    expect(mentionCandidates(experts, "ALPHA").map((item) => item.name)).toEqual(["a"]);
    expect(mentionCandidates(experts, "storage").map((item) => item.name)).toEqual(["b"]);
    expect(mentionCandidates(experts, "电池").map((item) => item.name)).toEqual(["b"]);
    expect(mentionCandidates(experts, "nobody")).toEqual([]);
  });
});
