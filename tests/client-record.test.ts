import { describe, expect, it } from "vitest";
import { normalizeExpertRecord } from "../src/client/setting/records.js";
import { validateSettings } from "../src/index.js";
import type { ExpertRecord } from "../src/types.js";

const draft: ExpertRecord = {
  id: " test-agent ",
  name: " 测试代理 ",
  description: " 测试描述 ",
  category: "business",
  tags: [" 测试 "],
  persona: " 你是测试代理 ",
  origin: { kind: "managed" },
  enabled: true,
};

describe("expert-ai record normalization", () => {
  it("preserves inline persona when the agent path is omitted", () => {
    const normalized = normalizeExpertRecord(draft);

    expect(normalized).toMatchObject({
      id: "test-agent",
      name: "测试代理",
      description: "测试描述",
      tags: ["测试"],
      persona: "你是测试代理",
      origin: { kind: "managed" },
    });
    expect(normalized).not.toHaveProperty("agent");
    expect(normalized).not.toHaveProperty("expertPackage");
    expect(normalized).not.toHaveProperty("tag");
    expect(() => validateSettings({ records: [normalized] })).not.toThrow();
  });

  it("uses an explicit agent path as a file origin instead of inline persona", () => {
    const normalized = normalizeExpertRecord({
      ...draft,
      origin: undefined,
      agent: " ~/.agent/agents/test-agent.md ",
    });

    expect(normalized.origin).toEqual({ kind: "file", path: "~/.agent/agents/test-agent.md" });
    expect(normalized.persona).toBe("");
    expect(normalized).not.toHaveProperty("agent");
    // A Host file is the identity source, so the record needs no inline persona.
    expect(() => validateSettings({ records: [normalized] })).not.toThrow();
  });

  it("preserves persona edits for the managed agent binding", () => {
    const normalized = normalizeExpertRecord({
      ...draft,
      agent: "test-agent/agents/test-agent.md",
      persona: " 更新后的人格 ",
    });

    expect(normalized.origin).toEqual({ kind: "managed" });
    expect(normalized.persona).toBe("更新后的人格");
  });

  it("reads legacy bundled and package bindings as canonical origins", () => {
    const bundled = normalizeExpertRecord({
      ...draft,
      origin: undefined,
      agent: "experts/xingtu/clq/AGENTS.md",
      persona: "",
    });
    expect(bundled.origin).toEqual({ kind: "bundled", path: "experts/xingtu/clq" });

    const packageRecord = normalizeExpertRecord({
      ...draft,
      origin: undefined,
      persona: "",
      expertPackage: {
        source: "mimeographs",
        slug: "clq-expert",
        revision: "a".repeat(40),
        ref: "main",
      },
    });
    expect(packageRecord.origin).toEqual({
      kind: "package",
      source: "mimeographs",
      slug: "clq-expert",
      revision: "a".repeat(40),
      ref: "main",
    });
    expect(packageRecord).not.toHaveProperty("expertPackage");
  });

  it.each([
    ["experts/ELON", "experts/ELON"],
    ["experts/xingtu/ELON", "experts/xingtu/ELON"],
    ["experts/xingtu/team/ELON", "experts/xingtu/team/ELON"],
    ["./experts/xingtu/ELON/", "experts/xingtu/ELON"],
    ["experts\\xingtu\\ELON", "experts/xingtu/ELON"],
  ])("accepts a bundled pack at any depth: %s", (path, expected) => {
    const normalized = normalizeExpertRecord({ ...draft, origin: { kind: "bundled", path }, persona: "" });
    expect(normalized.origin).toEqual({ kind: "bundled", path: expected });
    expect(() => validateSettings({ records: [normalized] })).not.toThrow();
  });

  it.each([
    "experts",
    "experts/",
    "xingtu/ELON",
    "/experts/ELON",
    "experts/../ELON",
    "experts//ELON",
  ])("refuses a bundled path outside experts/: %s", (path) => {
    const normalized = normalizeExpertRecord({ ...draft, origin: { kind: "bundled", path }, persona: "" });
    expect(() => validateSettings({ records: [normalized] })).toThrow(/directory under experts/);
  });

  it("migrates a legacy agent path at any depth, keeping folder case", () => {
    for (const path of ["experts/ELON", "experts/xingtu/ELON", "experts/xingtu/team/ELON"]) {
      const normalized = normalizeExpertRecord({ ...draft, origin: undefined, agent: `${path}/AGENTS.md`, persona: "" });
      expect(normalized.origin).toEqual({ kind: "bundled", path });
    }
  });

  it("drops blank model and toolFilter fields and trims non-blank ones", () => {
    const blank = normalizeExpertRecord({
      ...draft,
      model: { provider: " ", model: "" },
      toolFilter: ["", "  "],
    });
    expect(blank).not.toHaveProperty("model");
    expect(blank).not.toHaveProperty("toolFilter");

    const set = normalizeExpertRecord({
      ...draft,
      model: { provider: " openai ", model: " gpt-4.1 " },
      toolFilter: [" read_file ", "read_file", "web_search"],
    });
    expect(set.model).toEqual({ provider: "openai", model: "gpt-4.1" });
    expect(set.toolFilter).toEqual(["read_file", "web_search"]);
  });
});

describe("expert-ai presentation fields", () => {
  const avatar = { mime: "image/png" as const, data: "iVBORw0KGgo=" };

  it("trims the title and the source note and drops blank ones", () => {
    const normalized = normalizeExpertRecord({
      ...draft,
      title: "  创业思考助手  ",
      source: { kind: "organization", note: " 内部访谈 " },
    });
    expect(normalized).toMatchObject({ title: "创业思考助手", source: { kind: "organization", note: "内部访谈" } });

    const blank = normalizeExpertRecord({ ...draft, title: "   ", source: { kind: "public", note: "  " } });
    expect(blank).not.toHaveProperty("title");
    expect(blank.source).toEqual({ kind: "public" });
  });

  it("keeps an avatar and drops a cleared one", () => {
    expect(normalizeExpertRecord({ ...draft, avatar }).avatar).toEqual(avatar);
    expect(normalizeExpertRecord({ ...draft, avatar: undefined })).not.toHaveProperty("avatar");
  });

  it("adds nothing to a record that has none of them", () => {
    const normalized = normalizeExpertRecord(draft);
    for (const key of ["title", "avatar", "source"]) expect(normalized, key).not.toHaveProperty(key);
  });

  it("reads a null avatar or source, as YAML gives for an empty value, as absent", () => {
    const normalized = normalizeExpertRecord({ ...draft, avatar: null, source: null } as unknown as ExpertRecord);
    expect(normalized).not.toHaveProperty("avatar");
    expect(normalized).not.toHaveProperty("source");
  });

  it("merges a legacy single tag into the canonical tags", () => {
    const normalized = normalizeExpertRecord({ ...draft, tags: [], tag: " 方法 " });
    expect(normalized.tags).toEqual(["方法"]);
    expect(normalized).not.toHaveProperty("tag");
  });

  it("produces settings the Host accepts", () => {
    const normalized = normalizeExpertRecord({
      ...draft,
      title: " 助手 ",
      avatar,
      source: { kind: "authorized", note: " 授权书 " },
    });
    expect(() => validateSettings({ records: [normalized] })).not.toThrow();
  });
});
