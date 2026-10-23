import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import { Session } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { createScope } from "@deepseek-ai/dsh-scope";
import { afterEach, describe, expect, it } from "vitest";
import * as plugin from "../src/index.js";
import { loadBinding } from "../src/host/runtime/index.js";
import { fakeHostConnection } from "./host-connection.js";

const RECORD = {
  id: "clq", name: "陈立泉", description: "固态电池", category: "science", tags: [], persona: "关注固态电池。",
  toolFilter: ["read_file"], enabled: true,
};

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function start(records: unknown[]) {
  const root = await mkdtemp(join(tmpdir(), "expert-ai-chat-"));
  const ctx = new Context();
  cleanups.push(async () => {
    await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(ToolRuntime);
  const host = fakeHostConnection();
  const agents = new Map<string, unknown>();
  ctx.provide("subagents", { getProvider: () => undefined });
  ctx.provide("agents", { get: (id: string) => agents.get(id) });
  ctx.provide("connection", host.connection);
  ctx.provide("sandboxPolicy", { defaultMode: "workspace-write" });
  for (const name of ["read_file", "write_file"]) {
    ctx.tools.register(defineTool({
      name, description: name, parameters: {},
      output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
      async execute() { return name; },
    }));
  }
  const fiber = await ctx.plugin(plugin, { stateDir: root, records } as never);
  await fiber.await();
  // The Harness gives each Agent a scoped context keyed by the Agent; mint one the same way.
  const agent = { id: "session-chat", session: Session.create("session-chat" as never), ctx: undefined as unknown as Context };
  // Mint it inside a plugin that injects what an Agent context may reach, as the agent registry does.
  await ctx.plugin({
    name: "fake-agent-scope",
    inject: ["tools", "systemPrompt"],
    apply: (inner: Context) => { agent.ctx = createScope(inner, agent).ctx; },
  });
  agents.set(agent.id, agent);
  const visible = () => ctx.tools.schemas(agent as never).map((tool) => tool.name).sort();
  return { root, host, agent, visible };
}

describe("a single-expert chat", () => {
  it("binds through the Host endpoint with the record's tool policy and saves the plan", async () => {
    const h = await start([RECORD]);
    expect(h.visible()).toContain("write_file");
    const bound = await h.host.call("bind", { sessionId: "session-chat", recordId: "clq" });
    expect(bound.error?.message ?? "").toBe("");
    expect(bound).toMatchObject({ ok: true });
    expect(h.visible()).toEqual(["read_file"]);
    const saved = await loadBinding("session-chat", h.root);
    expect(saved?.plan).toMatchObject({ expertId: "clq", policy: { sandbox: "read-only", tools: ["read_file"] } });
    expect(await h.host.call("binding", { sessionId: "session-chat" })).toEqual({ ok: true, value: { recordId: "clq" } });
    expect(await h.host.call("unbind", { sessionId: "session-chat" })).toMatchObject({ ok: true });
    expect(h.visible()).toContain("write_file");
    expect(await loadBinding("session-chat", h.root)).toBeUndefined();
  });

  it("refuses to bind an expert whose tool list names a tool that does not exist", async () => {
    const h = await start([{ ...RECORD, toolFilter: ["read_fiel"] }]);
    const reply = await h.host.call("bind", { sessionId: "session-chat", recordId: "clq" });
    expect(reply).toMatchObject({ ok: false, error: { code: "internal" } });
    expect(reply.error?.message).toContain("read_fiel");
    expect(await loadBinding("session-chat", h.root)).toBeUndefined();
    expect(h.visible()).toContain("write_file");
  });

  it("refuses a malformed request before it reaches the handler", async () => {
    const h = await start([RECORD]);
    expect(await h.host.call("bind", { sessionId: "session-chat" })).toMatchObject({ ok: false, error: { code: "invalid-request" } });
    expect(await h.host.call("greeting", { sessionId: 7, text: "hi" })).toMatchObject({ ok: false, error: { code: "invalid-request" } });
  });
});
