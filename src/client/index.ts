import type { Context as ClientContext } from "@deepseek-ai/cordis";
// Type-only: pulls the `slash.menu` dictionary merge and the trigger contracts.
import type {
  InputTriggerServiceContract,
  InputTriggerSource,
} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
// Type-only: pulls the ctx.slots service merge (SlotRegistry) into scope.
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
// Type-only: pulls the ctx.configForms service merge (ConfigForms) into scope.
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
// Type-only: pulls the settings nav-row slot declarations (icon option) into scope.
import type {} from "@deepseek-ai/dsh-client-ui-settings-plugins/client";
// Type-only: pulls the ctx.sessions service merge (ISessions) into scope.
import type { ISessions } from "@deepseek-ai/dsh-api-session-controller/client";
// Type-only: pulls the ctx.locale service merge into scope.
import type {} from "@deepseek-ai/dsh-client-locale/client";
// Type-only: pulls the ctx.uiWorkspace navigation service merge into scope.
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type { ClientConnectionRpc, ConnectionHandle } from "@deepseek-ai/dsh-client-connection/client";
import { IconUserOutlineRegular, IconUsersOutlineMedium } from "@deepseek-ai/dsh-client-ui-primitives";
import { EXPERT_AI_NAMESPACE } from "../constants.js";
import { callHost } from "./shared/hostCall.js";
import type { ExpertRecord, ExpertSettings } from "../types.js";
import type { ExpertCatalogEntry } from "../expert-types.js";
import { ExpertSettingSection, type ExpertSettingSectionInjected } from "./setting/ExpertSettingSection.js";
import { ChatPanel, type ChatPanelInjected } from "./chat-pane/ChatPanel.js";
import type { ExpertLibraryApi } from "./setting/library-api.js";
import { mentionCandidates } from "./chat-pane/mentions.js";
import { en, NS, zh, type ExpertKey } from "./shared/locales.js";
import { normalizeExpertRecord } from "./setting/records.js";
import { originOf } from "../record-model.js";

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
  "configForms",
  "locale",
  "sessions",
  "uiWorkspace",
];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "expert-ai: dictionaries");
  const t = ctx.locale.bind(NS);
  const form = ctx.configForms.get<ExpertSettings>(EXPERT_AI_ENTRY_ID);
  const rpc = (): ClientConnectionRpc => {
    const connection = ctx.get("connection") as ConnectionHandle | undefined;
    if (connection === undefined) throw new Error("expert-ai: connection service is unavailable");
    return connection.rpc as unknown as ClientConnectionRpc;
  };
  const callExpert = async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    const result = await callHost(rpc(), endpoint, payload);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as T;
  };
  const expertApi: ExpertLibraryApi = {
    async catalog(ref) {
      return callExpert<{ ref: string; cached: boolean; experts: ExpertCatalogEntry[] }>("expert/catalog", { ref });
    },
    async importExpert(slug, ref) {
      const imported = (record: ExpertRecord): boolean => {
        const origin = originOf(record);
        return origin.kind === "package" && origin.source === "mimeographs" && origin.slug === slug;
      };
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
      const canonical = normalizeExpertRecord({
        ...record,
        ...(record.origin?.kind === "package" && record.origin.ref === ""
          ? { origin: { ...record.origin, ref } }
          : {}),
      });
      const idRef = ref.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
      const next = records.some((item) => item.id === canonical.id)
        ? { ...canonical, id: `${canonical.id}-${idRef}` }
        : canonical;
      if (records.some((item) => item.id === next.id)) throw new Error(t("expertIdConflict", { id: next.id }));
      const normalized = records.map(normalizeExpertRecord);
      if (!await form.set("records", [...normalized, next])) throw new Error(t("writeFailed"));
      return next.id;
    },
  };
  const injected = (): ExpertSettingSectionInjected => ({
    hooks: { settings: form },
    form,
    expertApi,
    t,
    async loadIdentity(id) {
      return (await callExpert<{ identity: string }>("identity", { recordId: id })).identity;
    },
  });
  const records = (): NonNullable<ExpertSettings["records"]> =>
    form.getSnapshot().value?.records?.map(normalizeExpertRecord).filter((record) => record.enabled) ?? [];
  // The Host `dsh-session` and Client Session Controller both merge a `sessions`
  // service onto Context; read the Client contract explicitly.
  const sessions = ctx.get("sessions") as unknown as ISessions;
  const createSession: ChatPanelInjected["createSession"] = async (record) => {
    const project = await callHost(rpc(), "project", {});
    if (!project.ok) throw new Error(project.error.message);
    const cwd = (project.value as { cwd?: unknown }).cwd;
    if (typeof cwd !== "string" || cwd === "")
      throw new Error("expert-ai: project directory is unavailable");
    const sessionId = await sessions.create({ cwd });
    const reference = sessions.retain(sessionId, { source: "expertAi" });
    try {
      await reference.ready;
      const bound = await callHost(rpc(), "bind", { sessionId, recordId: record.id });
      if (!bound.ok) throw new Error(bound.error.message);
      const greeting = await callHost(rpc(), "greeting", {
        sessionId,
        text: t("sessionGreeting", { name: record.name, description: record.description }),
      });
      if (!greeting.ok) throw new Error(greeting.error.message);
      ctx.uiWorkspace.openSession(sessionId);
      return sessionId;
    } finally {
      reference.release();
    }
  };

  // Like ds-bot, picking an expert inserts plain mention text in this session.
  // Source names must be unique in the shared @ menu, so reuse the existing
  // `skill` name and label every candidate with its own section instead.
  const source: InputTriggerSource = {
    trigger: "@",
    name: "skill",
    order: 5,
    candidates(_session, { query }) {
      return Promise.resolve(
        mentionCandidates(records(), query).map((candidate) => ({
          ...candidate,
          icon: IconUserOutlineRegular,
          section: t("expertGroup"),
        })),
      );
    },
    warm() {
      void Promise.resolve();
    },
    lexicon() {
      return [...new Set(records().flatMap((item) => [item.id, item.name]))];
    },
    subscribeLexicon(_session, listener) {
      return form.subscribe(listener);
    },
    onPick({ candidate }) {
      return { text: candidate.value ?? `@${candidate.name} ` };
    },
    codec: {
      clipboardText: (ref) => `@${ref}`,
      serialize: (ref, signal) => signal.aborted
        ? Promise.reject(new Error("expert-ai: the submission was cancelled"))
        : Promise.resolve(`@${ref}`),
    },
  };

  // The settings section edits the identity library.
  // The nav-row icon option arrives with the harness after 0.2.0-rc.2; older
  // hosts drop it and draw their default glyph.
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: EXPERT_AI_NAMESPACE,
        order: 25,
        label: () => t("nav"),
        ...{ icon: IconUsersOutlineMedium },
        locale: NS,
        inject: injected,
      },
      ExpertSettingSection,
    ),
  );
  // Start a single-expert conversation from the sidebar.
  ctx.slots.inject("sidebar.footer.action", () =>
    ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "expert-ai-chat-panel",
        order: -10,
        locale: NS,
        inject: (): ChatPanelInjected => ({ records, createSession, t }),
      },
      ChatPanel,
    ),
  );
  const inputTriggers = ctx.get("inputTriggers") as InputTriggerServiceContract;
  ctx.effect(() => inputTriggers.registerSource(source), "expert-ai: expert mentions");
}
