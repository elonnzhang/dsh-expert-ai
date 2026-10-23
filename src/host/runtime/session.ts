/** The Session surface: mounts a chat plan on a live Agent and takes it off again. */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { createAssistantMessage } from "@deepseek-ai/dsh-llm";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import type { Session } from "@deepseek-ai/dsh-session";
// Type-only: pulls the ctx.systemPrompt service merge into this program.
import type {} from "@deepseek-ai/dsh-system-prompt";
import type { ExpertPlan } from "./plan.js";

export interface MountOptions {
  /**
   * Refuse a plan naming a tool that is not registered. A new binding is strict, so a typo
   * fails where the user can see it; restoring a saved Session keeps the known names and warns.
   */
  strictTools: boolean;
}

export interface SessionSurface {
  mount(agent: Agent, plan: ExpertPlan, options: MountOptions): void;
  unmount(agent: Agent, defaultSandbox: Parameters<typeof setSandboxMode>[1]): void;
}

export function createSessionSurface(ctx: Context): SessionSurface {
  const mounted = new WeakMap<Agent, () => void>();
  const knownTools = (agent: Agent, tools: readonly string[], strict: boolean): string[] => {
    const known = tools.filter((name) => agent.ctx.tools.get(name) !== undefined);
    const unknown = tools.filter((name) => !known.includes(name));
    if (unknown.length > 0) {
      if (strict) throw new Error(`expert-ai: unknown tools for this expert: ${unknown.join(", ")}`);
      ctx.logger.warn(`expert-ai: session "${String(agent.id)}" keeps only its known tools; missing: ${unknown.join(", ")}`);
    }
    return known;
  };
  return {
    mount(agent, plan, options) {
      // Validate before touching the Agent, so a refused plan leaves the previous one in place.
      const tools = plan.policy.tools === undefined ? undefined : knownTools(agent, plan.policy.tools, options.strictTools);
      mounted.get(agent)?.();
      const disposers = plan.sections.map((section) => agent.ctx.systemPrompt.section(section));
      // An empty allow list would be refused; keeping no global tool is not a state a record can ask for.
      if (tools !== undefined && tools.length > 0) disposers.push(agent.ctx.tools.restrict({ allow: tools }));
      mounted.set(agent, () => {
        for (const dispose of disposers.reverse()) dispose();
      });
      setSandboxMode(agent.session, plan.policy.sandbox);
    },
    unmount(agent, defaultSandbox) {
      mounted.get(agent)?.();
      mounted.delete(agent);
      setSandboxMode(agent.session, defaultSandbox);
    },
  };
}

const OPENING_MESSAGE_SOURCE = { provider: "expert-ai", model: "opening" } as const;

/** Append the local opening message without entering the agent loop. */
export function appendOpeningAssistantMessage(session: Session, text: string): void {
  const alreadyAppended = session.snapshotEvents().some(
    (event) =>
      event.type === "assistant/message" &&
      event.data.message.source.provider === OPENING_MESSAGE_SOURCE.provider &&
      event.data.message.source.model === OPENING_MESSAGE_SOURCE.model,
  );
  if (alreadyAppended) return;
  if (session.deriveMessages().length > 0)
    throw new Error("expert-ai: opening greeting requires a session without messages");

  const message = createAssistantMessage({
    content: [{ type: "text", text }],
    source: OPENING_MESSAGE_SOURCE,
  });
  session.append("turn/start", { turn: 0 });
  session.append("step/start", { turn: 0, step: 1 });
  session.append(
    "assistant/message",
    { turn: 0, step: 1, message, stream: [] },
    { surfaceOp: "append" },
  );
  session.append("step/end", { turn: 0, step: 1 });
  session.append("turn/end", { turn: 0, reason: { kind: "completed" } });
}
