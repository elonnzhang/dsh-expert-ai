import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ChatPanelInjected } from "../src/client/ChatPanel.js";
import type { AgentPresetSelectorInjected } from "../src/client/AgentPresetSelector.js";
import type { DigitalLifeFeature, DigitalLifeRecord } from "../src/types.js";
import type { ExpertTeam } from "../src/expert-types.js";
import type { ExpertWorkbenchApi } from "../src/client/ExpertWorkbench.js";
import { MIMEOGRAPHS_REVISION } from "../src/expert-types.js";

vi.mock("../src/client/ChatPanel.js", () => ({ ChatPanel: () => null }));
vi.mock("../src/client/AgentPresetSelector.js", () => ({ AgentPresetSelector: () => null }));
vi.mock("../src/client/DigitalLifeSettingSection.js", () => ({ DigitalLifeSettingSection: () => null }));
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({ IconUserOutlineRegular: () => null, IconUsersOutlineMedium: () => null }));

const { apply, inject } = await import("../src/client/index.js");

const record: DigitalLifeRecord = {
  id: "research-guide",
  name: "Research Guide",
  description: "Research help",
  category: "science",
  tags: [],
  persona: "Research carefully",
  enabled: true,
};

function setup(
  presets: readonly { id: string; broken?: string }[],
  options: {
    rosterUnavailable?: boolean;
    selectFails?: boolean;
    records?: DigitalLifeRecord[];
    teams?: ExpertTeam[];
    onSource?: (source: unknown) => void;
    features?: DigitalLifeFeature[];
    status?: "loading" | "ready" | "unavailable";
  } = {},
) {
  const calls: string[] = [];
  let configuredRecords = options.records ?? [record];
  let formStatus = options.status ?? "ready";
  let formFeatures: DigitalLifeFeature[] = options.features ?? ["identity", "conversation"];
  const formListeners = new Set<() => void>();
  const developerToolsListeners = new Set<() => void>();
  const activeSlots = new Map<symbol, string>();
  let activeSources = 0;
  let expertApi: ExpertWorkbenchApi | undefined;
  let promptContent: unknown;
  const sessionId = "session-1" as SessionId;
  let sessionPreset: string | undefined;
  const sessionListeners = new Set<() => void>();
  let createSession: ChatPanelInjected["createSession"] | undefined;
  let heroPriority: number | undefined;
  let heroInjected: AgentPresetSelectorInjected | undefined;
  let stagedHeroInjected: AgentPresetSelectorInjected | undefined;
  let createdCwd: string | undefined;
  const blocks: Array<{ sessionId: SessionId; reason?: string }> = [];
  const bindPayloads: unknown[] = [];
  let bindingValue: unknown = undefined;
  const conversation = {
    blocks: {
      set: (id: SessionId, block: { reason: string } | undefined) => {
        const index = blocks.findIndex((item) => item.sessionId === id);
        if (index >= 0) blocks.splice(index, 1);
        if (block !== undefined) blocks.push({ sessionId: id, reason: block.reason });
      },
    },
  };
  const sessions = {
    list: {
      getSnapshot: () => ({
        byId: sessionPreset === undefined ? {} : {
          [sessionId]: {
            id: sessionId,
            blank: true,
            projectionValues: { agentPreset: sessionPreset },
          },
        },
      }),
      subscribe: (listener: () => void) => {
        sessionListeners.add(listener);
        return () => sessionListeners.delete(listener);
      },
    },
    create: async (options?: { cwd?: string }) => {
      calls.push("create");
      createdCwd = options?.cwd;
      return sessionId;
    },
    retain: () => ({
      ready: Promise.resolve(),
      binding: {
        session: {
          prompt: async (content: unknown) => {
            calls.push("prompt");
            promptContent = content;
            return { ok: true };
          },
        },
      },
      release: () => { calls.push("release"); },
    }),
  };
  const remote = {
    agentPresets: {
      list: async () => {
        calls.push("list");
        if (options.rosterUnavailable)
          return { ok: false, error: { code: "gateway/invocation-unavailable", message: "No preset service" } };
        return { ok: true, value: { presets } };
      },
      select: async (_sessionId: SessionId, preset: string) => {
        calls.push(`select:${preset}`);
        if (options.selectFails) return { ok: false, error: { message: "Cannot select preset" } };
        return { ok: true, value: preset };
      },
    },
  };
  const ctx = {
    get: (service: string) => ({
      sessions,
      remote,
      conversation,
      connection: {
        rpc: {
          call: async (_channel: string, endpoint: string, payload?: unknown) => {
            calls.push(endpoint);
            if (endpoint === "bind") bindPayloads.push(payload);
            if (endpoint === "project") return { ok: true, value: { cwd: "/tmp/digital-life/projects/test" } };
            if (endpoint === "binding") return { ok: true, value: bindingValue };
            if (endpoint === "expert/import") return { ok: true, value: { record: {
              ...record, id: "mimeograph-test-expert", name: "Imported expert",
              expertPackage: { source: "mimeographs", slug: "test-expert", revision: MIMEOGRAPHS_REVISION, ref: "main" },
            } } };
            return { ok: true, value: {} };
          },
        },
      },
      inputTriggers: {
        registerSource: (s: unknown) => {
          options.onSource?.(s);
          activeSources += 1;
          let live = true;
          return () => { if (live) { live = false; activeSources -= 1; } };
        },
      },
    })[service as "sessions" | "remote" | "connection" | "inputTriggers"],
    effect: (install: () => unknown) => install(),
    locale: { register: () => () => {}, bind: () => (key: string) => key },
    configForms: {
      developerTools: {
        enabled: {
          getSnapshot: () => true,
          subscribe: (listener: () => void) => {
            developerToolsListeners.add(listener);
            return () => { developerToolsListeners.delete(listener); };
          },
        },
      },
      get: () => ({
        getSnapshot: () => ({
          status: formStatus,
          writable: true,
          value: formStatus === "ready"
            ? { features: formFeatures, records: configuredRecords, teams: options.teams ?? [] }
            : undefined,
        }),
        set: async (_key: string, value: DigitalLifeRecord[]) => { configuredRecords = value; calls.push("save-records"); return true; },
        subscribe: (listener: () => void) => {
          formListeners.add(listener);
          return () => { formListeners.delete(listener); };
        },
      }),
    },
    uiWorkspace: { openSession: () => { calls.push("open"); } },
    slots: {
      inject: (_slot: string, install: () => unknown) => install(),
      register: (options: {
        name: string;
        priority?: number;
        inject?: () => unknown;
      }) => {
        if (options.name === "sidebar.footer.action")
          createSession = (options.inject?.() as ChatPanelInjected).createSession;
        if (options.name === "settings.section") expertApi = (options.inject?.() as { expertApi: ExpertWorkbenchApi }).expertApi;
        if (options.name === "conversation.hero.agentPreset") {
          heroPriority = options.priority;
          heroInjected = (options.inject?.("session-1") as AgentPresetSelectorInjected);
          stagedHeroInjected = (options.inject?.(undefined) as AgentPresetSelectorInjected);
        }
        const token = Symbol(options.name);
        activeSlots.set(token, options.name);
        return () => { activeSlots.delete(token); };
      },
    },
  } as unknown as Context;
  apply(ctx);
  const publishForm = (): void => { for (const listener of [...formListeners]) listener(); };
  return {
    calls,
    get createSession() {
      if (createSession === undefined) throw new Error("Chat Panel was not registered");
      return createSession;
    },
    slots: () => [...activeSlots.values()].sort(),
    sources: () => activeSources,
    subscriptions: () => ({
      settings: formListeners.size,
      developerTools: developerToolsListeners.size,
      sessions: sessionListeners.size,
    }),
    setFeatures(next: DigitalLifeFeature[]) {
      formFeatures = next;
      publishForm();
    },
    setStatus(next: "loading" | "ready" | "unavailable") {
      formStatus = next;
      publishForm();
    },
    get expertApi() { return expertApi!; },
    get records() { return configuredRecords; },
    get promptContent() { return promptContent; },
    get heroPriority() { return heroPriority; },
    get heroInjected() {
      return heroInjected;
    },
    get stagedHeroInjected() {
      return stagedHeroInjected;
    },
    get blocks() {
      return blocks;
    },
    bindPayloads,
    setBinding(value: unknown) {
      bindingValue = value;
    },
    get createdCwd() {
      return createdCwd;
    },
    publishBlankSession(preset: string) {
      sessionPreset = preset;
      for (const listener of sessionListeners) listener();
    },
  };
}

describe("digital-life standalone sessions", () => {
  it("imports an expert without replacing other records", async () => {
    const fixture = setup([]);
    await fixture.expertApi.importExpert("test-expert", "main");
    expect(fixture.records).toHaveLength(2);
    expect(fixture.records[0]).toBe(record);
    expect(fixture.records[1]?.expertPackage?.ref).toBe("main");
  });

  it("preserves edits and disabled state on repeated import", async () => {
    const existing: DigitalLifeRecord = { ...record, name: "User customized", enabled: false,
      expertPackage: { source: "mimeographs", slug: "test-expert", revision: MIMEOGRAPHS_REVISION, ref: "main" } };
    const fixture = setup([], { records: [existing] });
    expect(await fixture.expertApi.importExpert("test-expert", "main")).toBe(existing.id);
    expect(fixture.records).toEqual([existing]);
    expect(fixture.calls).not.toContain("expert/import");
    expect(fixture.calls).not.toContain("save-records");
  });

  it("gives a conflicting imported version a separate record ID", async () => {
    const existing = { ...record, id: "mimeograph-test-expert", name: "User record" };
    const fixture = setup([], { records: [existing] });
    const id = await fixture.expertApi.importExpert("test-expert", "release/v1.0");
    expect(id).toBe("mimeograph-test-expert-release-v1-0");
    expect(fixture.records[0]).toEqual(existing);
  });

  it("opens and submits a review request after binding the session", async () => {
    const reviewer = { ...record, id: "critic" };
    const fixture = setup([{ id: "digital-life-mode" }], { records: [record, reviewer] });
    await fixture.expertApi.startReview({ question: "Review this plan", expertIds: [record.id], reviewerId: reviewer.id, teamId: "plan-review" });
    expect(fixture.calls).toEqual(["project", "create", "list", "select:digital-life-mode", "bind", "open", "prompt", "release"]);
    // The `t` mock echoes locale keys, so the submission carries the instruction key.
    // The real instruction text that names start_team_run is covered by locales.test.ts.
    expect(JSON.stringify(fixture.promptContent)).toContain("reviewRequestInstruction");
    expect(JSON.stringify(fixture.promptContent)).toContain("Review this plan");
    expect(JSON.stringify(fixture.promptContent)).toContain("plan-review");
    // The session is hosted by the team, not by its first analyst.
    expect(fixture.bindPayloads).toEqual([{ sessionId: "session-1", teamId: "plan-review" }]);
  });

  it("reopens the session that owns a saved review", () => {
    const fixture = setup([]);
    fixture.expertApi.openReviewSession("review-session");
    expect(fixture.calls).toContain("open");
  });

  it("hosts an ad-hoc review session by its lineup", async () => {
    const reviewer = { ...record, id: "critic" };
    const fixture = setup([{ id: "digital-life-mode" }], { records: [record, reviewer] });
    await fixture.expertApi.startReview({ question: "Review this plan", expertIds: [record.id], reviewerId: reviewer.id });
    expect(fixture.bindPayloads).toEqual([{ sessionId: "session-1", lineup: { analystIds: [record.id], reviewerId: reviewer.id } }]);
  });

  it("does not block a session hosted by an expert team", async () => {
    const fixture = setup([{ id: "digital-life-mode" }]);
    fixture.setBinding({ team: { id: "plan-review", name: "方案评审" } });
    const selector = fixture.heroInjected;
    if (selector === undefined) throw new Error("Hero selector was not injected");
    await expect(selector.load()).resolves.toMatchObject({ current: "digital-life-mode", team: "方案评审" });
    expect(fixture.blocks).toEqual([]);
  });

  it("declares the preset remote used by session creation and the selector", () => {
    expect(inject).toContain("remote.agentPresets");
  });

  it("lets the native preset seat win and selects an available digital-life mode before binding", async () => {
    const fixture = setup([{ id: "digital-life-mode" }]);
    await fixture.createSession(record);
    expect(fixture.heroPriority).toBeLessThan(0);
    expect(fixture.createdCwd).toBe("/tmp/digital-life/projects/test");
    expect(fixture.calls).toEqual(["project", "create", "list", "select:digital-life-mode", "bind", "greeting", "open", "release"]);
  });

  it("still binds a persona when the deployment has no digital-life mode", async () => {
    const { calls, createSession } = setup([{ id: "standard" }]);
    await createSession(record);
    expect(calls).toEqual(["project", "create", "list", "bind", "greeting", "open", "release"]);
  });

  it("does not select a broken digital-life mode", async () => {
    const { calls, createSession } = setup([{ id: "digital-life-mode", broken: "Unavailable" }]);
    await createSession(record);
    expect(calls).toEqual(["project", "create", "list", "bind", "greeting", "open", "release"]);
  });

  it("can start without the optional preset service", async () => {
    const { calls, createSession } = setup([], { rosterUnavailable: true });
    await createSession(record);
    expect(calls).toEqual(["project", "create", "list", "bind", "greeting", "open", "release"]);
  });

  it("does not bind or prompt after a preset selection refusal", async () => {
    const { calls, createSession } = setup([{ id: "digital-life-mode" }], { selectFails: true });
    await expect(createSession(record)).rejects.toThrow("Cannot select preset");
    expect(calls).toEqual(["project", "create", "list", "select:digital-life-mode", "release"]);
  });

  it("uses the isolated project for an independent Chat session", async () => {
    const fixture = setup([]);
    await fixture.createSession();
    expect(fixture.createdCwd).toBe("/tmp/digital-life/projects/test");
    expect(fixture.calls).toEqual(["project", "create", "greeting", "open", "release"]);
  });

  it("blocks the composer until the current digital life is selected", async () => {
    const fixture = setup([{ id: "digital-life-mode" }]);
    const selector = fixture.heroInjected;
    if (selector === undefined) throw new Error("Hero selector was not injected");
    await expect(selector.load()).resolves.toMatchObject({ current: "digital-life-mode" });
    expect(fixture.blocks).toEqual([{ sessionId: "session-1", reason: "chooseLifeRequired" }]);
    await selector.selectLife(record.id);
    expect(fixture.blocks).toEqual([]);
  });

  it("creates a plugin project when a digital life is chosen without a workspace", async () => {
    const fixture = setup([{ id: "digital-life-mode" }]);
    const selector = fixture.stagedHeroInjected;
    if (selector === undefined) throw new Error("Staged hero selector was not injected");
    await selector.selectLife(record.id);
    expect(fixture.calls).toEqual([
      "project",
      "create",
      "list",
      "select:digital-life-mode",
      "bind",
      "open",
      "release",
    ]);
    expect(fixture.createdCwd).toBe("/tmp/digital-life/projects/test");
  });

  it("applies a preset staged on the new-session screen", async () => {
    const fixture = setup([{ id: "standard" }]);
    const selector = fixture.stagedHeroInjected;
    if (selector === undefined) throw new Error("Staged hero selector was not injected");
    await selector.select("standard");
    fixture.publishBlankSession("minimal");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.calls).toContain("select:standard");
  });

  it("unbinds the digital life when switching to a normal preset", async () => {
    const fixture = setup([{ id: "standard" }]);
    const selector = fixture.heroInjected;
    if (selector === undefined) throw new Error("Hero selector was not injected");
    fixture.publishBlankSession("digital-life-mode");
    await selector.select("standard");
    expect(fixture.calls).toContain("select:standard");
    expect(fixture.calls).toContain("unbind");
  });

  it("offers saved teams after experts in @ candidates", async () => {
    let source: { candidates: (session: unknown, input: { query: string }) => Promise<Array<{ name: string }>> } | undefined;
    setup([], { teams: [{ id: "study", name: "Study", purpose: "Plans", analystIds: [record.id], reviewerId: record.id }], onSource: (s) => { source = s as typeof source; } });
    expect((await source!.candidates(undefined, { query: "" })).map((item) => item.name)).toEqual([record.id, "study"]);
  });
});

const ALL_SLOTS = [
  "conversation.hero.agentPreset",
  "main",
  "settings.section",
  "sidebar.footer.action",
  "sidebar.panellist",
];

describe("digital-life conversation switch", () => {
  it("registers only the settings section while conversation is off", () => {
    const fixture = setup([], { features: ["identity"] });
    expect(fixture.slots()).toEqual(["settings.section"]);
    expect(fixture.sources()).toBe(0);
    expect(fixture.calls).toEqual([]);
    expect(() => fixture.createSession).toThrow("Chat Panel was not registered");
  });

  it("registers every conversation surface when conversation is on", () => {
    const fixture = setup([]);
    expect(fixture.slots()).toEqual(ALL_SLOTS);
    expect(fixture.sources()).toBe(1);
  });

  it("keeps the identity library editable while conversation is off", async () => {
    const fixture = setup([], { features: ["identity"] });
    await fixture.expertApi.importExpert("test-expert", "main");
    expect(fixture.records).toHaveLength(2);
  });

  it("registers the conversation surfaces only once the setting is known", () => {
    const fixture = setup([], { status: "loading" });
    expect(fixture.slots()).toEqual(["settings.section"]);
    expect(fixture.sources()).toBe(0);
    fixture.setStatus("ready");
    expect(fixture.slots()).toEqual(ALL_SLOTS);
    expect(fixture.sources()).toBe(1);
  });

  it("keeps conversation off when the settings are unavailable", () => {
    const fixture = setup([], { status: "unavailable" });
    expect(fixture.slots()).toEqual(["settings.section"]);
    expect(fixture.sources()).toBe(0);
  });

  it("removes every conversation surface when conversation is switched off", () => {
    const fixture = setup([]);
    fixture.setFeatures(["identity"]);
    expect(fixture.slots()).toEqual(["settings.section"]);
    expect(fixture.sources()).toBe(0);
  });
  it("mounts again when conversation is switched back on", async () => {
    const fixture = setup([]);
    fixture.setFeatures(["identity"]);
    fixture.setFeatures(["identity", "conversation"]);
    expect(fixture.slots()).toEqual(ALL_SLOTS);
    expect(fixture.sources()).toBe(1);
    await fixture.createSession(record);
    expect(fixture.calls).toContain("bind");
  });

  it("holds no subscription of its own while conversation is off", () => {
    const fixture = setup([]);
    expect(fixture.subscriptions()).toEqual({ settings: 1, developerTools: 1, sessions: 1 });
    fixture.setFeatures(["identity"]);
    expect(fixture.subscriptions()).toEqual({ settings: 1, developerTools: 0, sessions: 0 });
    fixture.setFeatures(["identity", "conversation"]);
    expect(fixture.subscriptions()).toEqual({ settings: 1, developerTools: 1, sessions: 1 });
  });

  it("releases the composer block when conversation is switched off", async () => {
    const fixture = setup([{ id: "digital-life-mode" }]);
    await fixture.heroInjected?.load();
    expect(fixture.blocks).toEqual([{ sessionId: "session-1", reason: "chooseLifeRequired" }]);
    fixture.setFeatures(["identity"]);
    expect(fixture.blocks).toEqual([]);
  });

  it("stops applying staged presets once conversation is switched off", async () => {
    const fixture = setup([{ id: "standard" }]);
    await fixture.stagedHeroInjected?.select("standard");
    fixture.setFeatures(["identity"]);
    fixture.publishBlankSession("minimal");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.calls).not.toContain("select:standard");
  });
});
