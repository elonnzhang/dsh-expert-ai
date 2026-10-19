import { describe, expect, it } from "vitest";
import { normalizeDigitalLifeRecord } from "../src/client/records.js";
import { validateSettings } from "../src/index.js";
import type { DigitalLifeRecord } from "../src/types.js";

const draft: DigitalLifeRecord = {
  id: " test-agent ",
  name: " 测试代理 ",
  description: " 测试描述 ",
  category: "business",
  tags: [" 测试 "],
  persona: " 你是测试代理 ",
  enabled: true,
};

describe("digital-life record normalization", () => {
  it("preserves inline persona when the agent path is omitted", () => {
    const normalized = normalizeDigitalLifeRecord(draft);

    expect(normalized).toMatchObject({
      id: "test-agent",
      name: "测试代理",
      description: "测试描述",
      tags: ["测试"],
      persona: "你是测试代理",
      agent: "test-agent/agents/test-agent.md",
    });
    expect(() => validateSettings({ records: [normalized] })).not.toThrow();
  });

  it("uses an explicit agent path instead of inline persona", () => {
    const normalized = normalizeDigitalLifeRecord({
      ...draft,
      agent: " ~/.agent/agents/test-agent.md ",
    });

    expect(normalized.agent).toBe("~/.agent/agents/test-agent.md");
    expect(normalized.persona).toBe("");
    expect(() => validateSettings({ records: [normalized] })).not.toThrow();
  });

  it("preserves persona edits for the managed agent binding", () => {
    const normalized = normalizeDigitalLifeRecord({
      ...draft,
      agent: "test-agent/agents/test-agent.md",
      persona: " 更新后的人格 ",
    });

    expect(normalized.agent).toBe("test-agent/agents/test-agent.md");
    expect(normalized.persona).toBe("更新后的人格");
  });
});

describe("digital-life presentation fields", () => {
  const avatar = { mime: "image/png" as const, data: "iVBORw0KGgo=" };

  it("trims the title and the source note and drops blank ones", () => {
    const normalized = normalizeDigitalLifeRecord({
      ...draft,
      title: "  创业思考助手  ",
      source: { kind: "organization", note: " 内部访谈 " },
    });
    expect(normalized).toMatchObject({ title: "创业思考助手", source: { kind: "organization", note: "内部访谈" } });

    const blank = normalizeDigitalLifeRecord({ ...draft, title: "   ", source: { kind: "public", note: "  " } });
    expect(blank).not.toHaveProperty("title");
    expect(blank.source).toEqual({ kind: "public" });
  });

  it("keeps an avatar and drops a cleared one", () => {
    expect(normalizeDigitalLifeRecord({ ...draft, avatar }).avatar).toEqual(avatar);
    expect(normalizeDigitalLifeRecord({ ...draft, avatar: undefined })).not.toHaveProperty("avatar");
  });

  it("adds nothing to a record that has none of them", () => {
    const normalized = normalizeDigitalLifeRecord(draft);
    for (const key of ["title", "avatar", "source"]) expect(normalized, key).not.toHaveProperty(key);
  });

  it("reads a null avatar or source, as YAML gives for an empty value, as absent", () => {
    const normalized = normalizeDigitalLifeRecord({ ...draft, avatar: null, source: null } as unknown as DigitalLifeRecord);
    expect(normalized).not.toHaveProperty("avatar");
    expect(normalized).not.toHaveProperty("source");
  });

  it("produces settings the Host accepts", () => {
    const normalized = normalizeDigitalLifeRecord({
      ...draft,
      title: " 助手 ",
      avatar,
      source: { kind: "authorized", note: " 授权书 " },
    });
    expect(() => validateSettings({ records: [normalized] })).not.toThrow();
  });
});
