import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
// Type-only: pulls the Session Controller service merge (ctx.sessions).
import type {
  ISessions,
  SessionSummary,
} from "@deepseek-ai/dsh-api-session-controller/client";
// Type-only: pulls the remote.agentPresets namespace and the
// projectionValues.agentPreset projection merge into this program.
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import type {} from "@deepseek-ai/dsh-agent-preset-registry/remote";
import type { AgentPresetRow } from "@deepseek-ai/dsh-agent-preset-registry/types";
// Type-only: pulls the slots service (ctx.slots) merge into this program.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type { IConversation } from "@deepseek-ai/dsh-client-ui-conversation/client";
import type { ClientRemote } from "@deepseek-ai/dsh-api-remotes/client";
import type { ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import type { DigitalLifeRecord } from "../types.js";
import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { NS } from "./locales.js";
import { callHost } from "./hostCall.js";
import {
  AgentPresetSelector,
  type AgentPresetSelectorInjected,
} from "./AgentPresetSelector.js";

/** Read the preset one session's summary currently runs, if any. */
function presetOf(summary: SessionSummary | undefined): string | undefined {
  const value = summary?.projectionValues?.agentPreset;
  return typeof value === "string" ? value : undefined;
}

const BUILT_IN_PRESET_COPY: Record<string, readonly [string, string]> = {
  standard: ["presetStandardName", "presetStandardDescription"],
  ptc: ["presetPtcName", "presetPtcDescription"],
  minimal: ["presetMinimalName", "presetMinimalDescription"],
  cordis: ["presetCordisName", "presetCordisDescription"],
};

function presetDisplayText(
  preset: AgentPresetRow,
  translate: (key: string) => string,
): { name: string; description?: string } {
  const keys = preset.name === undefined ? BUILT_IN_PRESET_COPY[preset.id] : undefined;
  if (keys !== undefined) return { name: translate(keys[0]), description: translate(keys[1]) };
  return {
    name: preset.name ?? preset.id,
    ...(preset.description === undefined ? {} : { description: preset.description }),
  };
}

export type PrepareDigitalLifeSession = (record: DigitalLifeRecord) => Promise<SessionId>;

/** Install the composite Agent preset and digital-life selector into the Hero slot; the returned disposer removes it and its composer blocks. */
export function installAgentPresetSelector(
  ctx: ClientContext,
  records: () => readonly DigitalLifeRecord[],
  t: TranslateNS<"digital-life">,
  prepareSession: PrepareDigitalLifeSession,
): () => void {
  // The Host `dsh-session` and Client Session Controller both merge a `sessions`
  // service onto Context; read the Client contract explicitly.
  const sessions = ctx.get("sessions") as unknown as ISessions;
  const remote = ctx.get("remote") as unknown as ClientRemote;
  const conversation = ctx.get("conversation") as IConversation;
  const presetT = ctx.locale.bind("settings.agentPreset" as never) as (key: string) => string;
  const developerTools = ctx.configForms.developerTools.enabled;
  const injectedBySession = new Map<string | undefined, AgentPresetSelectorInjected>();
  const selectedLifeBySession = new Map<string, string>();
  // Sessions hosted by an expert team (review sessions): team name by session id.
  const teamBySession = new Map<string, string>();
  const stagedPreset: { id: string | undefined } = { id: undefined };
  const rpcOf = (): ClientConnectionRpc => {
    const connection = ctx.get("connection") as ConnectionHandle | undefined;
    if (connection === undefined)
      throw new Error("digital-life: connection service is unavailable");
    return connection.rpc as unknown as ClientConnectionRpc;
  };
  const lifeFor = async (sessionId: SessionId): Promise<string | undefined> => {
    const cached = selectedLifeBySession.get(sessionId);
    if (cached !== undefined) return cached || undefined;
    const result = await callHost(rpcOf(), "binding", { sessionId });
    if (!result.ok) throw new Error(result.error.message);
    const value = result.value as { recordId?: unknown; team?: { name?: unknown } } | undefined;
    if (typeof value?.team?.name === "string") teamBySession.set(sessionId, value.team.name);
    const recordId = value?.recordId;
    const selected = typeof recordId === "string" && records().some((record) => record.id === recordId)
      ? recordId
      : "";
    selectedLifeBySession.set(sessionId, selected);
    return selected || undefined;
  };
  const blockedSessions = new Set<SessionId>();
  const setLifeBlock = (sessionId: SessionId, selected: string | undefined): void => {
    // A team-hosted session already has its own identity.
    blockedSessions.add(sessionId);
    conversation.blocks.set(
      sessionId,
      selected === undefined && !teamBySession.has(sessionId) ? { reason: t("chooseLifeRequired") } : undefined,
    );
  };
  const clearLifeBlock = (sessionId: SessionId): void => {
    blockedSessions.delete(sessionId);
    conversation.blocks.set(sessionId, undefined);
  };
  const applyStagedPreset = async (): Promise<void> => {
    const id = stagedPreset.id;
    if (id === undefined || !developerTools.getSnapshot()) return;
    const summary = Object.values(sessions.list.getSnapshot().byId).find((item) => item.blank);
    if (summary === undefined) return;
    if (presetOf(summary) === id) return;
    const result = await remote.agentPresets.select(summary.id, id);
    if (!result.ok) throw new Error(result.error.message);
    stagedPreset.id = undefined;
  };
  const stopStagedPreset = ctx.effect(
    () => {
      const stop = sessions.list.subscribe(() => {
        void applyStagedPreset().catch((error) => {
          ctx.logger.error("digital-life: failed to apply staged preset", error);
        });
      });
      return stop;
    },
    "digital-life: staged preset",
  );
  const stopDeveloperToolsGate = ctx.effect(
    () => developerTools.subscribe(() => {
      if (!developerTools.getSnapshot()) stagedPreset.id = undefined;
    }),
    "digital-life: Developer tools gate",
  );
  // The hero seat is a `session-maybe` slot, so the framework supplies the
  // current session id (or undefined on the new-session screen). All per-life
  // selection is scoped to that id.
  const injected = (rawSessionId: string | undefined): AgentPresetSelectorInjected => {
    const cached = injectedBySession.get(rawSessionId);
    if (cached !== undefined) return cached;
    const sessionId = rawSessionId as SessionId | undefined;
    let selectedPreset = "";
    const value: AgentPresetSelectorInjected = {
      records,
      t,
      developerTools: developerTools as ObservableSnapshot<boolean>,
      async selectLife(id) {
        const record = records().find((item) => item.id === id);
        if (record === undefined) throw new Error(`digital-life: unknown record "${id}"`);
        if (sessionId === undefined) {
          const createdSessionId = await prepareSession(record);
          selectedLifeBySession.set(createdSessionId, id);
          return;
        }
        const result = await callHost(rpcOf(), "bind", {
          sessionId,
          recordId: id,
        });
        if (!result.ok) throw new Error(result.error.message);
        selectedLifeBySession.set(sessionId, id);
        teamBySession.delete(sessionId);
        setLifeBlock(sessionId, id);
      },
      async load() {
        if (!developerTools.getSnapshot()) return { options: [], current: "" };
        const response = await remote.agentPresets.list();
        if (!response.ok) {
          if (response.error.code === "gateway/invocation-unavailable")
            return { options: [], current: "" };
          throw new Error(response.error.message);
        }
        const presets = response.value.presets.filter(
          (item: AgentPresetRow) => item.broken === undefined,
        );
        const summary =
          sessionId === undefined
            ? undefined
            : sessions.list.getSnapshot().byId[sessionId];
        selectedPreset =
          stagedPreset.id ||
          selectedPreset ||
          presetOf(summary) ||
          presets.find((item: AgentPresetRow) => item.isDefault)?.id ||
          presets[0]?.id ||
          "";
        const life = sessionId === undefined || selectedPreset !== "digital-life-mode"
          ? undefined
          : await lifeFor(sessionId);
        if (sessionId !== undefined) {
          if (selectedPreset === "digital-life-mode") setLifeBlock(sessionId, life);
          else clearLifeBlock(sessionId);
        }
        return {
          options: presets.map((item: AgentPresetRow) => {
            const display = presetDisplayText(item, presetT);
            return {
              id: item.id,
              name: display.name,
              ...(display.description === undefined
                ? {}
                : { description: display.description }),
            };
          }),
          current: selectedPreset,
          ...(life === undefined ? {} : { life }),
          ...(life === undefined && sessionId !== undefined && teamBySession.has(sessionId)
            ? { team: teamBySession.get(sessionId)! }
            : {}),
        };
      },
      async select(id) {
        if (!developerTools.getSnapshot()) return;
        if (sessionId === undefined) {
          selectedPreset = id;
          stagedPreset.id = id;
          void applyStagedPreset().catch((error) => {
            ctx.logger.error("digital-life: failed to apply staged preset", error);
          });
          return;
        }
        const summary = sessions.list.getSnapshot().byId[sessionId];
        // A running session keeps the composition it began with; the Host
        // refuses to adopt a started session under a different preset.
        if (summary === undefined || !summary.blank || presetOf(summary) === id)
          return;
        const result = await remote.agentPresets.select(sessionId, id);
        if (!result.ok) throw new Error(result.error.message);
        selectedPreset = id;
        if (id === "digital-life-mode") {
          setLifeBlock(sessionId, await lifeFor(sessionId));
        } else {
          const unbound = await callHost(rpcOf(), "unbind", { sessionId });
          if (!unbound.ok) throw new Error(unbound.error.message);
          selectedLifeBySession.delete(sessionId);
          teamBySession.delete(sessionId);
          clearLifeBlock(sessionId);
        }
      },
    };
    injectedBySession.set(rawSessionId, value);
    return value;
  };
  const removeSlot = ctx.slots.inject("conversation.hero.agentPreset", () =>
    ctx.slots.register(
      {
        name: "conversation.hero.agentPreset",
        priority: -10,
        locale: NS,
        inject: injected,
      },
      AgentPresetSelector,
    ),
  );
  return () => {
    removeSlot();
    void stopDeveloperToolsGate();
    void stopStagedPreset();
    for (const sessionId of blockedSessions) conversation.blocks.set(sessionId, undefined);
    blockedSessions.clear();
  };
}
