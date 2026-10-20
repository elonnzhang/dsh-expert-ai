import { describe, expect, it } from "vitest";
import { Context } from "@deepseek-ai/cordis";
import { createScope, type Scope } from "@deepseek-ai/dsh-scope";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime, { defineTool } from "@deepseek-ai/dsh-tools";
import { ToolCallId } from "@deepseek-ai/dsh-llm";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createExpertService } from "../src/host/expert-service.js";

describe("expert tools on the actual Harness registry", () => {
  it("honors child restrictions while preserving child-owned structured output", async () => {
    const ctx = new Context();
    await ctx.plugin(SystemPrompt, {});
    await ctx.plugin(ToolRuntime);
    const service = createExpertService({ current: () => ({ provider: "spawn", records: [] }), stateDir: () => undefined });
    const unregister = service.registerTools({ ctx });
    let scope!: Scope;
    const agent = { id: "session-scope-test" } as Agent;
    try {
      await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, agent); }, { inject: ["tools", "systemPrompt"] }));
      const restrict = scope.ctx.tools.restrict({ allow: [] });
      scope.ctx.tools.register(defineTool({
        name: "structured_output", description: "Capture result", parameters: {},
        output: { schema: { type: "boolean" }, render: () => [{ type: "text", text: "captured" }] },
        execute: async () => true,
      }));
      expect(ctx.tools.schemas(agent).map((tool) => tool.name)).toEqual(["structured_output"]);
      const result = await ctx.tools.execute({ agent, signal: new AbortController().signal, callId: ToolCallId("test-call"), name: "read_expert_reference", arguments: { id: "x" } });
      expect(result.isError).toBe(true);
      restrict();
      scope.ctx.tools.restrict({ allow: ["read_expert_reference"] });
      expect(ctx.tools.schemas(agent).map((tool) => tool.name).sort()).toEqual(["read_expert_reference", "structured_output"]);
    } finally {
      unregister();
      await ctx.fiber.dispose();
    }
  });
});
