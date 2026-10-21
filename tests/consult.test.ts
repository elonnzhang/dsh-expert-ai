import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { Session } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../src/index.js";
import { fakeHostConnection } from "./host-connection.js";

const RECORD = {
  id: "clq", name: "陈立泉", description: "固态电池", category: "science", tags: ["固态电池"],
  persona: "关注固态电池。", enabled: true,
};
const HIDDEN = { ...RECORD, id: "hidden", name: "停用", enabled: false, persona: "不应出现。" };

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

/** A provider registry that records what each consultation asked for and answers with a fixed text. */
function fakeSubagents(options: { capabilities?: { persona?: boolean; toolFilter?: boolean }; missing?: boolean } = {}) {
  const runs: Array<{ provider: string; request: Record<string, unknown>; disposed: boolean }> = [];
  const capabilities = {
    persona: options.capabilities?.persona ?? true,
    toolFilter: options.capabilities?.toolFilter ?? true,
  };
  const registry = {
    getProvider: (provider: string) =>
      options.missing === true || provider !== "spawn" ? undefined : { capabilities },
    start: async (provider: string, request: Record<string, unknown>) => {
      const run = { provider, request, disposed: false };
      runs.push(run);
      return {
        id: "run-1",
        result: Promise.resolve({
          stopReason: "completed",
          output: [{ type: "text", text: "先给结论，再给依据。" }],
        }),
        dispose: async () => {
          run.disposed = true;
        },
      };
    },
  };
  return { registry, runs };
}

async function start(options: {
  records?: readonly (typeof RECORD)[];
  subagents?: ReturnType<typeof fakeSubagents>;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "expert-ai-consult-"));
  const ctx = new Context();
  cleanups.push(async () => {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  const subagents = options.subagents ?? fakeSubagents();
  const agents = new Map<string, unknown>();
  ctx.provide("subagents", subagents.registry);
  ctx.provide("agents", { get: (id: string) => agents.get(id) });
  ctx.provide("connection", fakeHostConnection().connection);
  ctx.provide("sandboxPolicy", { defaultMode: "read-only" });
  // The plugin reads its config fields lazily, so a fixed value serves every read.
  await ctx.plugin(plugin, { stateDir: root, records: options.records ?? [RECORD] } as never);
  const session = Session.create("session-consult" as never);
  const agent = { id: "session-consult", session, ctx };
  agents.set("session-consult", agent);
  const call = (id: unknown) => ctx.tools.execute({
    agent: agent as never,
    signal: new AbortController().signal,
    callId: ToolCallId("call-1"),
    name: "consult_expert",
    arguments: id === undefined ? {} : { id, question: "下一步做什么？" },
  } as never);
  return { ctx, root, runs: subagents.runs, call, tools: () => ctx.tools.schemas().map((tool) => tool.name).sort() };
}

describe("consult_expert", () => {
  it("registers the consultation and local reference tools", async () => {
    const h = await start();
    expect(h.tools()).toEqual(["consult_expert", "read_expert_reference"]);
  });

  it("runs the expert as a persona subagent and returns its answer", async () => {
    const h = await start();
    const result = await h.call("clq");
    expect(result.isError).toBeFalsy();
    expect(h.runs).toHaveLength(1);
    const run = h.runs[0]!;
    expect(run.provider).toBe("spawn");
    expect(run.request).toMatchObject({ label: "专家：陈立泉", persona: "关注固态电池。" });
    const prompt = run.request.prompt as Array<{ type: string; text: string }>;
    expect(prompt[0]?.text).toContain("<question>\n下一步做什么？\n</question>");
    // The persona travels as the subagent persona, never inside the prompt.
    expect(prompt[0]?.text).not.toContain("关注固态电池。");
    expect(run.disposed).toBe(true);
    expect(JSON.stringify(result)).toContain("先给结论");
  });

  it("runs the consultation on the spawn provider", async () => {
    const h = await start();
    await h.call("clq");
    expect(h.runs[0]?.provider).toBe("spawn");
  });

  it("reports an unknown or disabled expert, and an unconfigured provider", async () => {
    const absent = await start({ records: [RECORD, HIDDEN] });
    expect((await absent.call("nobody")).isError).toBe(true);
    expect((await absent.call("hidden")).isError).toBe(true);
    expect(absent.runs).toHaveLength(0);

    const missing = await start({ subagents: fakeSubagents({ missing: true }) });
    const result = await missing.call("clq");
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("is unavailable");
  });

  it("refuses a provider without persona support", async () => {
    const h = await start({ subagents: fakeSubagents({ capabilities: { persona: false } }) });
    const result = await h.call("clq");
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("does not support persona");
  });

  it("forwards a record's toolFilter and model to the subagent", async () => {
    const h = await start({
      records: [{ ...RECORD, toolFilter: ["read_file"], model: { provider: "p", model: "m" } }],
    });
    await h.call("clq");
    expect(h.runs[0]?.request).toMatchObject({ toolFilter: { allow: ["read_file"] }, agentOptions: { provider: "p", model: "m" } });
  });
});
