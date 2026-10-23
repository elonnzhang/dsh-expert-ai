import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";
import { normalizeRecord } from "../src/record-model.js";
import {
  chatSections,
  compileChatPlan,
  compileConsultationPlan,
  createSessionSurface,
  policyFor,
  type ExpertPlan,
} from "../src/host/runtime/index.js";
import { dispatch, defineEndpoint } from "../src/host/rpc/index.js";
import z from "@deepseek-ai/schemastery";

const record = normalizeRecord({
  id: "clq", name: "陈立泉", description: "固态电池", category: "science", tags: ["固态电池"], persona: "",
  origin: { kind: "bundled", path: "experts/xingtu/clq" }, toolFilter: [" read_file ", "read_file"],
  model: { provider: "p", model: " " }, enabled: true,
});

describe("the expert runtime compiler", () => {
  it("compiles one policy for both the chat and the consultation", () => {
    const chat = compileChatPlan(record, "人设正文");
    const consult = compileConsultationPlan(record, "人设正文", "下一步？");
    expect(chat.policy).toEqual({ sandbox: "read-only", tools: ["read_file"], model: { provider: "p" } });
    expect(consult.policy).toEqual(chat.policy);
    expect(consult.revision).toBe(chat.revision);
    expect(consult.persona).toBe("人设正文");
    expect(consult.prompt).toContain("<question>\n下一步？\n</question>");
    expect(consult.prompt).not.toContain("人设正文");
  });

  it("drops blank tools and model fields", () => {
    expect(policyFor({ toolFilter: [" "], model: { provider: "", model: " " } })).toEqual({ sandbox: "read-only" });
    expect(policyFor({})).toEqual({ sandbox: "read-only" });
  });

  it("keeps the identity body a section of its own, after the mode and header", () => {
    const sections = chatSections(record, "  人设正文  ");
    expect(sections.map((section) => [section.name, section.order])).toEqual([
      ["expert-ai:source", 1], ["expert-ai:pre", 2], ["expert-ai:persona", 3], ["expert-ai:suf", 4],
    ]);
    expect(sections[2]?.text).toBe("人设正文");
    expect(sections[1]?.text).toContain("# 专家：陈立泉（@clq）");
  });

  it("tells a package expert how to read its references, and no one else", () => {
    const pkg = normalizeRecord({
      ...record, origin: { kind: "package", source: "mimeographs", slug: "x", revision: "a".repeat(40), ref: "main" },
    });
    expect(compileChatPlan(pkg, "x").sections.at(-1)?.text).toContain("read_expert_reference");
    expect(compileChatPlan(record, "x").sections.at(-1)?.text).not.toContain("read_expert_reference");
  });
});

function fakeAgent(registered: string[]) {
  const sections: Array<{ name: string }> = [];
  const restrictions: Array<{ allow?: readonly string[] }> = [];
  const sandbox: { mode?: string } = {};
  const agent = {
    id: "session-1",
    session: {
      // setSandboxMode appends a session event; record the last mode it wrote.
      append: (_type: string, data: { mode?: string }) => { sandbox.mode = data.mode; },
      snapshotEvents: () => [],
    },
    ctx: {
      systemPrompt: {
        section: (section: { name: string }) => {
          sections.push(section);
          return () => { sections.splice(sections.indexOf(section), 1); };
        },
      },
      tools: {
        get: (name: string) => (registered.includes(name) ? {} : undefined),
        restrict: (filter: { allow?: readonly string[] }) => {
          restrictions.push(filter);
          return () => { restrictions.splice(restrictions.indexOf(filter), 1); };
        },
      },
    },
  };
  return { agent: agent as never, sections, restrictions };
}

vi.mock("@deepseek-ai/dsh-sandbox-policy", () => ({ setSandboxMode: vi.fn() }));

describe("the Session surface", () => {
  const plan: ExpertPlan = compileChatPlan(record, "人设正文");

  it("mounts the sections and the tool policy, and takes both off again", async () => {
    const { setSandboxMode } = await import("@deepseek-ai/dsh-sandbox-policy");
    const surface = createSessionSurface(new Context());
    const fake = fakeAgent(["read_file"]);
    surface.mount(fake.agent, plan, { strictTools: true });
    expect(fake.sections.map((section) => section.name)).toEqual(plan.sections.map((section) => section.name));
    expect(fake.restrictions).toEqual([{ allow: ["read_file"] }]);
    expect(setSandboxMode).toHaveBeenLastCalledWith(expect.anything(), "read-only");
    surface.mount(fake.agent, plan, { strictTools: true });
    expect(fake.sections).toHaveLength(plan.sections.length);
    expect(fake.restrictions).toHaveLength(1);
    surface.unmount(fake.agent, "workspace-write" as never);
    expect(fake.sections).toEqual([]);
    expect(fake.restrictions).toEqual([]);
    expect(setSandboxMode).toHaveBeenLastCalledWith(expect.anything(), "workspace-write");
  });

  it("refuses a new binding that names an unknown tool, and leaves the Agent untouched", () => {
    const surface = createSessionSurface(new Context());
    const fake = fakeAgent([]);
    expect(() => { surface.mount(fake.agent, plan, { strictTools: true }); }).toThrow(/unknown tools.*read_file/);
    expect(fake.sections).toEqual([]);
  });

  it("restores a saved Session with the tools it still knows", () => {
    const surface = createSessionSurface(new Context());
    const fake = fakeAgent([]);
    surface.mount(fake.agent, plan, { strictTools: false });
    expect(fake.sections).toHaveLength(plan.sections.length);
    expect(fake.restrictions).toEqual([]);
  });
});

describe("Host endpoints", () => {
  const endpoint = defineEndpoint("bind", z.object({ sessionId: z.string().required(), recordId: z.string().required() }), async (input) => input);

  it("hands the handler a checked payload", async () => {
    expect(await dispatch(endpoint, { sessionId: "s", recordId: "r" })).toEqual({ ok: true, value: { sessionId: "s", recordId: "r" } });
  });

  it.each([
    ["a missing field", { sessionId: "s" }],
    ["a wrong type", { sessionId: 1, recordId: "r" }],
    ["no object", "text"],
  ])("refuses %s as an invalid request", async (_label, payload) => {
    const result = await dispatch(endpoint, payload);
    expect(result).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    if (!result.ok) expect(result.error.message).toMatch(/^expert-ai: invalid bind request/);
  });

  it("reports a failing handler as internal", async () => {
    const failing = defineEndpoint("project", z.object({}), async () => { throw new Error("disk full"); });
    expect(await dispatch(failing, {})).toEqual({ ok: false, error: { code: "internal", message: "disk full", details: {} } });
  });
});
