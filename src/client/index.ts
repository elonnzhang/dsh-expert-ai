import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { AgentPresetRow } from "@deepseek-ai/dsh-agent-preset-registry/types";
import type { ClientRemote } from "@deepseek-ai/dsh-api-remotes/client";
import type {
  InputTriggerServiceContract,
  InputTriggerSource,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
// Type-only: pulls the ctx.slots service merge (SlotRegistry) into scope.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
// Type-only: pulls the ctx.configForms service merge (ConfigForms) into scope.
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
// Type-only: pulls the ctx.sessions service merge (ISessions) into scope.
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
// Type-only: pulls the ctx.uiWorkspace navigation service merge into scope.
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {
  ClientConnectionRpc,
  ConnectionHandle,
} from "@deepseek-ai/dsh-client-connection/client";
import { IconUserOutlineRegular, IconUsersOutlineMedium } from "@deepseek-ai/dsh-client-ui-primitives";
import { EXPERT_AI_NAMESPACE } from "../constants.js";
import { callHost } from "./hostCall.js";
import type { ExpertRecord, ExpertSettings } from "../types.js";
import {
  ExpertSettingSection,
  type ExpertSettingSectionInjected,
} from "./ExpertSettingSection.js";
import { ChatPanel, type ChatPanelInjected } from "./ChatPanel.js";
import {
  installAgentPresetSelector,
  type PrepareExpertSession,
} from "./installAgentPresetSelector.js";
import { en, NS, zh, type ExpertKey } from "./locales.js";
import type { ExpertLibraryApi } from "./library-api.js";
import { mentionCandidates } from "./mentions.js";
import { mountWhile } from "./feature-gate.js";
import type { ExpertCatalogEntry } from "../expert-types.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "expert-ai": ExpertKey;
  }
}

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    /** An expert-ai session retained while its opening greeting is written. */
    expertAi: unknown;
  }
}

/** The Host plugin entry id whose settings this Client half edits. */
const EXPERT_AI_ENTRY_ID = EXPERT_AI_NAMESPACE;

export const inject = [
  "slots",
  "inputTriggers",
  "connection",
  "remote",
  "remote.agentPresets",
  "conversation",
  "configForms",
  "locale",
  "sessions",
  "uiWorkspace",
];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "expert-ai: dictionaries");
  const t = ctx.locale.bind(NS);
  const form = ctx.configForms.get<ExpertSettings>(EXPERT_AI_ENTRY_ID);
  const callExpert = async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    const connection = ctx.get("connection") as ConnectionHandle | undefined;
    if (connection === undefined) throw new Error("expert-ai: connection service is unavailable");
    const result = await callHost(connection.rpc as unknown as ClientConnectionRpc, endpoint, payload);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as T;
  };
  const expertApi: ExpertLibraryApi = {
    async catalog(ref) {
      return callExpert<{ ref: string; cached: boolean; experts: ExpertCatalogEntry[] }>("expert/catalog", { ref });
    },
    async importExpert(slug, ref) {
      const imported = (record: ExpertRecord): boolean =>
        record.expertPackage?.slug === slug && record.expertPackage.ref === ref;
      const snapshot = form.getSnapshot();
      if (!snapshot.writable || snapshot.value === undefined) throw new Error(t("unavailable"));
      const existing = snapshot.value.records?.find(imported);
      if (existing !== undefined) return existing.id;
      const { record } = await callExpert<{ record: ExpertRecord }>("expert/import", { slug, ref });
      const latest = form.getSnapshot();
      if (!latest.writable || latest.value === undefined) throw new Error(t("unavailable"));
      if (latest.value.stateDir !== snapshot.value.stateDir) throw new Error(t("expertDirectoryChanged"));
      const records = latest.value.records ?? [];
      const samePackage = records.find(imported);
      if (samePackage !== undefined) return samePackage.id;
      const next = records.some((item) => item.id === record.id)
        ? { ...record, id: `${record.id}-${ref.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}` }
        : record;
      if (records.some((item) => item.id === next.id)) throw new Error(t("expertIdConflict", { id: next.id }));
      if (!await form.set("records", [...records, next])) throw new Error(t("writeFailed"));
      return next.id;
    },
  };
  const injected = (): ExpertSettingSectionInjected => ({
    hooks: { settings: form },
    form,
    t,
    expertApi,
    async loadIdentity(id) {
      const connection = ctx.get("connection") as ConnectionHandle | undefined;
      if (connection === undefined)
        throw new Error("expert-ai: connection service is unavailable");
      const rpc = connection.rpc as unknown as ClientConnectionRpc;
      const result = await callHost(rpc, "identity", { recordId: id });
      if (!result.ok) throw new Error(result.error.message);
      return (result.value as { identity: string }).identity;
    },
  });
  const records = (): NonNullable<ExpertSettings["records"]> =>
    form.getSnapshot().value?.records?.filter((record) => record.enabled) ?? [];
  // The Host `dsh-session` and Client Session Controller both merge a `sessions`
  // service onto Context; read the Client contract explicitly.
  const sessions = ctx.get("sessions") as unknown as ISessions;
  const remote = ctx.get("remote") as ClientRemote;
  const selectExpertMode = async (sessionId: SessionId): Promise<void> => {
    const roster = await remote.agentPresets.list();
    if (!roster.ok && roster.error.code !== "gateway/invocation-unavailable")
      throw new Error(roster.error.message);
    const modeAvailable = roster.ok && roster.value.presets.some(
      (preset: AgentPresetRow) => preset.id === "expert-ai-mode" && preset.broken === undefined,
    );
    if (modeAvailable) {
      const selected = await remote.agentPresets.select(sessionId, "expert-ai-mode");
      if (!selected.ok) throw new Error(selected.error.message);
    }
  };
  const prepareSession = async (target?: { recordId: string }) => {
    const connection = ctx.get("connection") as ConnectionHandle | undefined;
    if (connection === undefined)
      throw new Error("expert-ai: connection service is unavailable");
    const rpc = connection.rpc as unknown as ClientConnectionRpc;
    const project = await callHost(rpc, "project", {});
    if (!project.ok) throw new Error(project.error.message);
    const cwd = (project.value as { cwd?: unknown }).cwd;
    if (typeof cwd !== "string" || cwd === "")
      throw new Error("expert-ai: project directory is unavailable");
    const sessionId = await sessions.create({ cwd });
    const reference = sessions.retain(sessionId, { source: "expertAi" });
    try {
      await reference.ready;
      if (target !== undefined) {
        await selectExpertMode(sessionId);
        const init = await callHost(rpc, "bind", { sessionId, ...target });
        if (!init.ok) throw new Error(init.error.message);
      }
      return { sessionId, reference };
    } catch (error) {
      reference.release();
      throw error;
    }
  };
  const openExpertSession: PrepareExpertSession = async (record) => {
    const { sessionId, reference } = await prepareSession({ recordId: record.id });
    try {
      ctx.uiWorkspace.openSession(sessionId);
      return sessionId;
    } finally {
      reference.release();
    }
  };
  const createSession: ChatPanelInjected["createSession"] = async (record) => {
    const { sessionId, reference } = await prepareSession(record === undefined ? undefined : { recordId: record.id });
    try {
      const connection = ctx.get("connection") as ConnectionHandle | undefined;
      if (connection === undefined)
        throw new Error("expert-ai: connection service is unavailable");
      const rpc = connection.rpc as unknown as ClientConnectionRpc;
      const text =
        record === undefined
          ? t("independentGreeting")
          : t("sessionGreeting", { name: record.name, description: record.description });
      const greeting = await callHost(rpc, "greeting", { sessionId, text });
      if (!greeting.ok) throw new Error(greeting.error.message);
      ctx.uiWorkspace.openSession(sessionId);
      return sessionId;
    } finally {
      reference.release();
    }
  };

  const chatInjected = (): ChatPanelInjected => ({ records, createSession, t });

  // The settings section stays in every mode: it edits the identity library.
  // The nav-row icon option arrives with the harness after 0.2.0-rc.2; older
  // hosts drop it and draw their default glyph.
  const navIcon = { icon: IconUsersOutlineMedium };
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: EXPERT_AI_NAMESPACE,
        order: 25,
        label: () => t("nav"),
        ...navIcon,
        locale: NS,
        inject: injected,
      },
      ExpertSettingSection,
    ),
  );

  const source: InputTriggerSource = {
    trigger: "@",
    name: EXPERT_AI_NAMESPACE,
    order: 5,
    candidates(_session, { query }) {
      return Promise.resolve(
        mentionCandidates(records(), query).map((candidate) => ({ ...candidate, icon: IconUserOutlineRegular })),
      );
    },
    warm() {
      void Promise.resolve();
    },
    lexicon() {
      return records().map((item) => item.id);
    },
    subscribeLexicon(_session, listener) {
      return form.subscribe(listener);
    },
    onPick({ candidate }) {
      return { text: `@${candidate.name} ` };
    },
    codec: {
      clipboardText: (ref) => `@${ref}`,
      serialize: (ref) => Promise.resolve(`@${ref}`),
    },
  };
  const inputTriggers = ctx.get("inputTriggers") as InputTriggerServiceContract;
  const mountConversation = (): (() => void) => {
    const disposers = [
      ctx.slots.inject("sidebar.footer.action", () =>
        ctx.slots.register(
          {
            name: "sidebar.footer.action",
            id: "expert-ai-chat-panel",
            order: -10,
            locale: NS,
            inject: chatInjected,
          },
          ChatPanel,
        ),
      ),
      installAgentPresetSelector(ctx, records, t, openExpertSession),
      inputTriggers.registerSource(source),
    ];
    return () => {
      for (const dispose of disposers.reverse()) void dispose();
    };
  };
  ctx.effect(() => mountWhile(form, "conversation", mountConversation), "expert-ai: conversation");
}
