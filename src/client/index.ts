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
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import type {
  ClientConnectionRpc,
  ConnectionHandle,
} from "@deepseek-ai/dsh-client-connection/client";
import { IconUserOutlineRegular, IconUsersOutlineMedium } from "@deepseek-ai/dsh-client-ui-primitives";
import { DIGITAL_LIFE_NAMESPACE } from "../constants.js";
import { callHost } from "./hostCall.js";
import type { DigitalLifeRecord, DigitalLifeSettings } from "../types.js";
import {
  DigitalLifeSettingSection,
  type DigitalLifeSettingSectionInjected,
} from "./DigitalLifeSettingSection.js";
import { ChatPanel, type ChatPanelInjected } from "./ChatPanel.js";
import {
  installAgentPresetSelector,
  type PrepareDigitalLifeSession,
} from "./installAgentPresetSelector.js";
import { en, NS, zh, type DigitalLifeKey } from "./locales.js";
import { reviewSubmission, type ExpertWorkbenchApi } from "./ExpertWorkbench.js";
import { mentionCandidates } from "./teams.js";
import { ExpertAIPanel, ExpertAIPanelIcon } from "./ExpertAIPanel.js";
import { mountWhile } from "./feature-gate.js";
import type { AnyReviewRun, ExpertCatalogEntry, ReviewSummary } from "../expert-types.js";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "digital-life": DigitalLifeKey;
  }
}

declare module "@deepseek-ai/dsh-api-session-controller/client" {
  interface SessionReferenceSourceMap {
    /** A digital-life session retained while its opening greeting is written. */
    digitalLife: unknown;
  }
}

/** The Host plugin entry id whose settings this Client half edits. */
const DIGITAL_LIFE_ENTRY_ID = DIGITAL_LIFE_NAMESPACE;
const EXPERT_AI_PANEL_ID = "expert-ai";

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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "digital-life: dictionaries");
  const t = ctx.locale.bind(NS);
  const form = ctx.configForms.get<DigitalLifeSettings>(DIGITAL_LIFE_ENTRY_ID);
  const callExpert = async <T,>(endpoint: string, payload: unknown): Promise<T> => {
    const connection = ctx.get("connection") as ConnectionHandle | undefined;
    if (connection === undefined) throw new Error("digital-life: connection service is unavailable");
    const result = await callHost(connection.rpc as unknown as ClientConnectionRpc, endpoint, payload);
    if (!result.ok) throw new Error(result.error.message);
    return result.value as T;
  };
  const expertApi: ExpertWorkbenchApi = {
    async catalog(ref) {
      return callExpert<{ ref: string; cached: boolean; experts: ExpertCatalogEntry[] }>("expert/catalog", { ref });
    },
    async importExpert(slug, ref) {
      const imported = (record: DigitalLifeRecord): boolean =>
        record.expertPackage?.slug === slug && record.expertPackage.ref === ref;
      const snapshot = form.getSnapshot();
      if (!snapshot.writable || snapshot.value === undefined) throw new Error(t("unavailable"));
      const existing = snapshot.value.records?.find(imported);
      if (existing !== undefined) return existing.id;
      const { record } = await callExpert<{ record: DigitalLifeRecord }>("expert/import", { slug, ref });
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
    async startReview(request) {
      const available = records();
      if (![...request.expertIds, request.reviewerId].every((id) => available.some((item) => item.id === id)))
        throw new Error(t("chooseExpert"));
      // The session is hosted by the team itself, never by one of its members.
      const { sessionId, reference } = await prepareSession(request.teamId === undefined
        ? { lineup: { analystIds: request.expertIds, reviewerId: request.reviewerId } }
        : { teamId: request.teamId });
      try {
        ctx.uiWorkspace.openSession(sessionId);
        const result = await reference.binding.session.prompt([{ type: "text", text: reviewSubmission(request, t("reviewRequestInstruction")) }], "queue");
        if (!result.ok) throw new Error(result.error.message);
      } finally { reference.release(); }
    },
    listReviews: () => callExpert<ReviewSummary[]>("review/list", {}),
    readReview: (id) => callExpert<{ run: AnyReviewRun; markdown: string }>("review/read", { id }),
    async cancelReview(id) { await callExpert("review/cancel", { id }); },
    openReviewSession(sessionId) {
      ctx.uiWorkspace.openSession(sessionId as SessionId);
    },
  };
  const injected = (): DigitalLifeSettingSectionInjected => ({
    hooks: { settings: form },
    form,
    t,
    expertApi,
    async loadIdentity(id) {
      const connection = ctx.get("connection") as ConnectionHandle | undefined;
      if (connection === undefined)
        throw new Error("digital-life: connection service is unavailable");
      const rpc = connection.rpc as unknown as ClientConnectionRpc;
      const result = await callHost(rpc, "identity", { recordId: id });
      if (!result.ok) throw new Error(result.error.message);
      return (result.value as { identity: string }).identity;
    },
  });
  const records = (): NonNullable<DigitalLifeSettings["records"]> =>
    form.getSnapshot().value?.records?.filter((record) => record.enabled) ?? [];
  const teams = (): NonNullable<DigitalLifeSettings["teams"]> => form.getSnapshot().value?.teams ?? [];
  // The Host `dsh-session` and Client Session Controller both merge a `sessions`
  // service onto Context; read the Client contract explicitly.
  const sessions = ctx.get("sessions") as unknown as ISessions;
  const remote = ctx.get("remote") as ClientRemote;
  const selectDigitalLifeMode = async (sessionId: SessionId): Promise<void> => {
    const roster = await remote.agentPresets.list();
    if (!roster.ok && roster.error.code !== "gateway/invocation-unavailable")
      throw new Error(roster.error.message);
    const modeAvailable = roster.ok && roster.value.presets.some(
      (preset: AgentPresetRow) => preset.id === "digital-life-mode" && preset.broken === undefined,
    );
    if (modeAvailable) {
      const selected = await remote.agentPresets.select(sessionId, "digital-life-mode");
      if (!selected.ok) throw new Error(selected.error.message);
    }
  };
  /** Who a new session is bound to: a digital life, a saved team, or an ad-hoc lineup. */
  type BindTarget =
    | { recordId: string }
    | { teamId: string }
    | { lineup: { analystIds: string[]; reviewerId: string } };
  const prepareSession = async (target?: BindTarget) => {
    const connection = ctx.get("connection") as ConnectionHandle | undefined;
    if (connection === undefined)
      throw new Error("digital-life: connection service is unavailable");
    const rpc = connection.rpc as unknown as ClientConnectionRpc;
    const project = await callHost(rpc, "project", {});
    if (!project.ok) throw new Error(project.error.message);
    const cwd = (project.value as { cwd?: unknown }).cwd;
    if (typeof cwd !== "string" || cwd === "")
      throw new Error("digital-life: project directory is unavailable");
    const sessionId = await sessions.create({ cwd });
    const reference = sessions.retain(sessionId, { source: "digitalLife" });
    try {
      await reference.ready;
      if (target !== undefined) {
        await selectDigitalLifeMode(sessionId);
        const init = await callHost(rpc, "bind", { sessionId, ...target });
        if (!init.ok) throw new Error(init.error.message);
      }
      return { sessionId, reference };
    } catch (error) {
      reference.release();
      throw error;
    }
  };
  const openDigitalLifeSession: PrepareDigitalLifeSession = async (record) => {
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
        throw new Error("digital-life: connection service is unavailable");
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
        id: DIGITAL_LIFE_NAMESPACE,
        order: 25,
        label: () => t("nav"),
        ...navIcon,
        locale: NS,
        inject: injected,
      },
      DigitalLifeSettingSection,
    ),
  );

  const source: InputTriggerSource = {
    trigger: "@",
    name: DIGITAL_LIFE_NAMESPACE,
    order: 5,
    candidates(_session, { query }) {
      // Experts win an id clash; mentionCandidates hides the shadowed team.
      return Promise.resolve(
        mentionCandidates(records(), teams(), query).map(({ name, description, kind }) => ({
          name,
          description,
          icon: kind === "team" ? IconUsersOutlineMedium : IconUserOutlineRegular,
        })),
      );
    },
    warm() {
      void Promise.resolve();
    },
    lexicon() {
      return [...records().map((item) => item.id), ...teams().map((team) => team.id)];
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
            id: "digital-life-chat-panel",
            order: -10,
            locale: NS,
            inject: chatInjected,
          },
          ChatPanel,
        ),
      ),
      installAgentPresetSelector(ctx, records, t, openDigitalLifeSession),
      // Expert AI is the full-width workbench surface behind the sidebar entry.
      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: EXPERT_AI_PANEL_ID,
            locale: NS,
            inject: () => ({ records, teams, expertApi, t }),
          },
          ExpertAIPanel,
        ),
      ),
      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: EXPERT_AI_PANEL_ID,
            order: 20,
            label: () => t("expertAiPanel"),
            locale: NS,
          },
          ExpertAIPanelIcon,
        ),
      ),
      inputTriggers.registerSource(source),
    ];
    return () => {
      for (const dispose of disposers.reverse()) void dispose();
    };
  };
  ctx.effect(() => mountWhile(form, "conversation", mountConversation), "digital-life: conversation");
}
