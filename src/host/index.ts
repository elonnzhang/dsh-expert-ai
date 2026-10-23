/**
 * Composition root. Each concern lives in its own module (see
 * docs/plans/2026-10-21-identity-and-runtime.md); this file only wires them together.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { HostConnectionHandle } from "@deepseek-ai/dsh-client-connection";
import type { SessionId } from "@deepseek-ai/dsh-session";
// Type-only: pulls the 'loader/volatile-update' event into cordis Events.
import type {} from "@deepseek-ai/cordis-plugin-loader";
// Type-only: pulls the ctx.settings service merge (SettingsForms) into this program.
import type {} from "@deepseek-ai/dsh-settings";
import type { CanonicalExpertRecord, ExpertRecord, ExpertSettings } from "../types.js";
import { Config, findRecord, resolved, validateSettings } from "./config.js";
import { ExpertIdentityProvider, identityFor } from "./identity/index.js";
import { createEndpoints, serveEndpoints } from "./rpc/index.js";
import {
  compileChatPlan,
  createSessionSurface,
  deleteBinding,
  loadBinding,
  registerExpertTools,
  saveBinding,
} from "./runtime/index.js";

export { Config, validateSettings } from "./config.js";
export { appendOpeningAssistantMessage, chatPromptParts } from "./runtime/index.js";

export const name = "expert-ai";
export const inject = ["tools", "subagents", "agents", "connection", "sandboxPolicy"];

export function apply(ctx: Context, config: Config): void {
  // Reactive live read of the current settings from the fiber's volatile refs.
  const source = (): ExpertSettings => {
    const stateDirValue = config.stateDir.get();
    return {
      ...(stateDirValue === undefined ? {} : { stateDir: stateDirValue }),
      records: config.records.get() as ExpertRecord[],
    };
  };
  const stateDir = (): string | undefined => source().stateDir?.trim() || undefined;
  const records = (): CanonicalExpertRecord[] => resolved(source()).records;
  const record = (id: string): CanonicalExpertRecord => findRecord(resolved(source()), id);
  const surface = createSessionSurface(ctx);

  const bind = async (agent: Agent, expert: CanonicalExpertRecord): Promise<void> => {
    const plan = compileChatPlan(expert, await identityFor(expert, stateDir()));
    // Mount first: a plan the Agent refuses (an unknown tool) is never saved.
    surface.mount(agent, plan, { strictTools: true });
    await saveBinding(agent.id, plan, stateDir());
  };
  const unbind = async (sessionId: string, agent: Agent | undefined): Promise<void> => {
    await deleteBinding(sessionId, stateDir());
    if (agent !== undefined) surface.unmount(agent, ctx.sandboxPolicy.defaultMode);
  };

  // A restarted Host mounts the plan a Session was bound with; the saved prompt is kept even
  // when the record changed since, and an older binding format is upgraded on disk.
  ctx.on("agent/created", async ({ agent }) => {
    try {
      const loaded = await loadBinding(agent.id, stateDir());
      if (loaded === undefined) return undefined;
      surface.mount(agent, loaded.plan, { strictTools: false });
      if (loaded.legacy) {
        await saveBinding(agent.id, loaded.plan, stateDir()).catch((error: unknown) => {
          ctx.logger.warn(`expert-ai: kept the saved prompt of session "${agent.id}"`, error);
        });
      }
    } catch (error) {
      ctx.logger.warn(`expert-ai: could not restore session "${agent.id}"`, error);
    }
    return undefined;
  });

  // Preferences edited through Settings apply to the running fiber in place;
  // opt out of an auto-generated page (the plugin ships its own settings.section).
  ctx.inject(["settings"], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
  });
  const connection = ctx.get("connection") as HostConnectionHandle;
  ctx.effect(
    () => serveEndpoints(connection, createEndpoints({
      stateDir,
      record,
      agent: (sessionId) => ctx.agents.get(sessionId as SessionId),
      bind,
      unbind,
    })),
    "expert-ai: host RPC",
  );
  // Reject a bad settings write before it commits.
  ctx.on(
    "internal/config",
    function (this: import("@deepseek-ai/cordis").Fiber, _raw, next) {
      const raw: unknown = next();
      if (this !== ctx.fiber) return raw;
      validateSettings(raw as ExpertSettings);
      return raw;
    },
  );
  validateSettings(source());
  ctx.effect(() => registerExpertTools(ctx, { record, stateDir }), "expert-ai: consultation tools");
  new ExpertIdentityProvider(ctx, { saved: records, records, stateDir });
}
