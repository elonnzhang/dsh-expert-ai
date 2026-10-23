import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ChatPanelInjected } from "../src/client/chat-pane/ChatPanel.js";
import type { ExpertRecord } from "../src/types.js";

vi.mock("../src/client/chat-pane/ChatPanel.js", () => ({ ChatPanel: () => null }));
vi.mock("../src/client/setting/ExpertSettingSection.js", () => ({ ExpertSettingSection: () => null }));
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({ IconUserOutlineRegular: () => null, IconUsersOutlineMedium: () => null }));

const { apply, inject } = await import("../src/client/index.js");

const record: ExpertRecord = {
  id: "research-guide",
  name: "Research Guide",
  description: "Research help",
  category: "science",
  tags: [],
  persona: "Research carefully",
  origin: { kind: "managed" },
  enabled: true,
};

function setup(options: {
  records?: ExpertRecord[];
  importedRecord?: ExpertRecord;
  status?: "loading" | "ready" | "unavailable";
} = {}) {
  const calls: string[] = [];
  let configuredRecords = options.records ?? [record];
  const formStatus = options.status ?? "ready";
  const formListeners = new Set<() => void>();
  const activeSlots = new Map<symbol, string>();
  const payloads = new Map<string, unknown>();
  let promptContent: unknown;
  const sessionId = "session-1" as SessionId;
  let createSession: ChatPanelInjected["createSession"] | undefined;
  let registeredSection: { inject?: () => unknown } | undefined;
  const sources: Array<{ name: string; candidates: Function; header: Function; lexicon: Function; onPick: Function; codec: unknown }> = [];
  const menuTitles: Array<{ locale: string; dictionary: Record<string, string> }> = [];
  const inputTriggers = {
    registerSource: (source: unknown) => {
      sources.push(source as (typeof sources)[number]);
      return () => {};
    },
  };
  const sessions = {
    create: async (createOptions?: { cwd?: string }) => {
      calls.push(`create:${createOptions?.cwd ?? ""}`);
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
  const ctx = {
    get: (service: string) => ({
      sessions,
      inputTriggers,
      connection: {
        rpc: {
          call: async (channel: string, method: string, payload?: unknown) => {
            if (channel !== "/api" || !method.startsWith("expert-ai/")) throw new Error(`unexpected RPC target ${channel}/${method}`);
            const endpoint = method.slice("expert-ai/".length);
            calls.push(endpoint);
            payloads.set(endpoint, payload);
            if (endpoint === "project") return { ok: true, value: { cwd: "/tmp/expert-ai/projects/test" } };
            if (endpoint === "expert/import") return { ok: true, value: { record: options.importedRecord } };
            return { ok: true, value: {} };
          },
        },
      },
    })[service as "sessions" | "inputTriggers" | "connection"],
    effect: (install: () => unknown) => install(),
    locale: {
      register: (namespace: string, localeOrDicts: unknown, maybeDict?: Record<string, string>) => {
        if (namespace !== "slash.menu") return () => {};
        menuTitles.push(maybeDict === undefined
          ? { locale: "all", dictionary: localeOrDicts as Record<string, string> }
          : { locale: localeOrDicts as string, dictionary: maybeDict });
        return () => {};
      },
      bind: () => (key: string) => key,
    },
    configForms: {
      get: () => ({
        getSnapshot: () => ({
          status: formStatus,
          writable: true,
          value: formStatus === "ready" ? { records: configuredRecords } : undefined,
        }),
        set: async (_key: string, value: ExpertRecord[]) => { configuredRecords = value; calls.push("save-records"); return true; },
        subscribe: (listener: () => void) => {
          formListeners.add(listener);
          return () => { formListeners.delete(listener); };
        },
      }),
    },
    uiWorkspace: { openSession: () => { calls.push("open"); } },
    slots: {
      inject: (_slot: string, install: () => unknown) => install(),
      register: (options: { name: string; inject?: () => unknown }) => {
        if (options.name === "sidebar.footer.action")
          createSession = (options.inject?.() as ChatPanelInjected).createSession;
        if (options.name === "settings.section") registeredSection = options;
        const token = Symbol(options.name);
        activeSlots.set(token, options.name);
        return () => { activeSlots.delete(token); };
      },
    },
  } as unknown as Context;
  apply(ctx);
  return {
    calls,
    payloads,
    get createSession() {
      if (createSession === undefined) throw new Error("Chat Panel was not registered");
      return createSession;
    },
    slots: () => [...activeSlots.values()].sort(),
    sources,
    menuTitles,
    get records() { return configuredRecords; },
    get promptContent() { return promptContent; },
    get expertApi() {
      if (registeredSection?.inject === undefined) throw new Error("Settings section was not registered");
      return (registeredSection.inject() as { expertApi: import("../src/client/setting/library-api.js").ExpertLibraryApi }).expertApi;
    },
  };
}

describe("expert-ai single-expert conversations", () => {
  it("declares the services a settings page, a conversation and the @ source need", () => {
    expect(inject).toEqual(["slots", "inputTriggers", "connection", "configForms", "locale", "sessions", "uiWorkspace"]);
  });

  it("registers the settings section, the sidebar entry and the @ source, nothing else", () => {
    const fixture = setup();
    expect(fixture.slots()).toEqual(["settings.section", "sidebar.footer.action"]);
    // `skill` is the existing `slash.menu` key the workspace already owns; the
    // locale service refuses a second registrant, so the source reuses it.
    expect(fixture.sources.map((source) => source.name)).toEqual(["skill"]);
    // The plugin never registers into the shared menu namespace.
    expect(fixture.menuTitles).toEqual([]);
  });

  it("starts a conversation with the isolated project, the bound expert and its greeting", async () => {
    const fixture = setup();
    await expect(fixture.createSession(record)).resolves.toBe("session-1");
    expect(fixture.calls).toEqual(["project", "create:/tmp/expert-ai/projects/test", "bind", "greeting", "open", "release"]);
    expect(fixture.payloads.get("bind")).toEqual({ sessionId: "session-1", recordId: record.id });
    expect(fixture.payloads.get("greeting")).toEqual({
      sessionId: "session-1",
      text: "sessionGreeting",
    });
  });

  it("shows the settings page while its configuration is still loading", () => {
    expect(setup({ status: "loading" }).slots()).toEqual(["settings.section", "sidebar.footer.action"]);
  });

  it("keeps every expert record editable through the form", async () => {
    const fixture = setup();
    expect(fixture.records).toEqual([record]);
  });
});

describe("the @ expert source", () => {
  it("offers enabled experts whose id, name, description or tags match", async () => {
    const disabled = { ...record, id: "retired", name: "Retired", enabled: false };
    const fixture = setup({ records: [record, disabled] });
    const source = fixture.sources[0]!;
    expect(await source.candidates(undefined, { query: "" })).toEqual([
      {
        name: record.id,
        label: record.name,
        description: record.description,
        value: `@${record.name} `,
        icon: expect.anything(),
        section: "expertGroup",
      },
    ]);
    expect(await source.candidates(undefined, { query: "RESEARCH" })).toHaveLength(1);
    expect(await source.candidates(undefined, { query: "retired" })).toEqual([]);
    expect(source.lexicon()).toEqual([record.id, record.name]);
  });

  it("inserts the picked expert's name without starting or opening a conversation", async () => {
    const fixture = setup();
    const source = fixture.sources[0]!;
    const [candidate] = await source.candidates(undefined, { query: record.id });
    const outcome = source.onPick({ candidate, session: { sessionId: "session-1" } });
    expect(outcome).toEqual({ text: `@${record.name} ` });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fixture.calls).toEqual([]);
  });

  it.each([record.id, record.name])("keeps a plain @%s mention in the current conversation", (ref) => {
    const fixture = setup();
    expect(fixture.sources[0]!.onPick({ candidate: { name: ref } })).toEqual({ text: `@${ref} ` });
    expect(fixture.calls).toEqual([]);
  });

  it("finds a Chinese display name and an id containing hyphens", async () => {
    const expert = { ...record, id: "battery-expert", name: "陈立泉" };
    const fixture = setup({ records: [expert] });
    const source = fixture.sources[0]!;
    for (const query of ["BATTERY-EXPERT", "陈立泉"]) {
      const [candidate] = await source.candidates(undefined, { query });
      expect(candidate).toMatchObject({ name: expert.id, label: expert.name });
      expect(source.onPick({ candidate })).toEqual({ text: "@陈立泉 " });
    }
    expect(source.lexicon()).toEqual([expert.id, expert.name]);
    expect(fixture.calls).toEqual([]);
  });

  it("matches a candidate by description", async () => {
    const fixture = setup({ records: [{ ...record, description: "Battery supply chains" }] });
    const [candidate] = await fixture.sources[0]!.candidates(undefined, { query: "supply chains" });
    expect(candidate?.name).toBe(record.id);
  });

  it("deduplicates names shared by expert names and ids in the lexicon", () => {
    const fixture = setup({ records: [{ ...record, name: record.id }] });
    expect(fixture.sources[0]!.lexicon()).toEqual([record.id]);
  });

  it("never starts a conversation for an id that is not enabled", () => {
    const disabled = { ...record, id: "retired", name: "Retired", enabled: false };
    const fixture = setup({ records: [record, disabled] });
    expect(fixture.sources[0]!.onPick({ candidate: { name: "retired" } })).toEqual({ text: "@retired " });
    expect(fixture.calls).toEqual([]);
  });

  it("serializes a mention as plain model text", async () => {
    const source = setup().sources[0]!;
    const codec = source.codec as { clipboardText(ref: string): string; serialize(ref: string, signal: AbortSignal): Promise<string> };
    for (const ref of [record.id, record.name, "陈立泉"]) {
      expect(codec.clipboardText(ref)).toBe(`@${ref}`);
      await expect(codec.serialize(ref, new AbortController().signal)).resolves.toBe(`@${ref}`);
    }
    const aborted = new AbortController();
    aborted.abort();
    await expect(codec.serialize(record.id, aborted.signal)).rejects.toThrow(/cancelled/);
  });
});

describe("expert package import", () => {
  const imported: ExpertRecord = {
    id: "clq-expert",
    name: "Clq Expert",
    description: "Battery method",
    category: "science",
    tags: ["mimeographs", "public-method"],
    persona: "",
    origin: {
      kind: "package",
      source: "mimeographs",
      slug: "clq-expert",
      revision: "a".repeat(40),
      ref: "main",
    },
    toolFilter: ["read_expert_reference"],
    enabled: true,
  };

  it("deduplicates by canonical package origin", async () => {
    const legacy: ExpertRecord = {
      id: "existing-clq",
      name: "Existing Clq",
      description: "Imported earlier",
      category: "science",
      tags: ["mimeographs"],
      persona: "",
      expertPackage: {
        source: "mimeographs",
        slug: "clq-expert",
        revision: "a".repeat(40),
        ref: "main",
      },
      enabled: true,
    };
    const fixture = setup({ records: [legacy], importedRecord: imported });
    await expect(fixture.expertApi.importExpert("clq-expert", "main")).resolves.toBe("existing-clq");
    expect(fixture.calls).toEqual([]);
    expect(fixture.records).toEqual([legacy]);
  });

  it("reuses the same slug even when a different source ref is requested", async () => {
    const fixture = setup({ records: [imported], importedRecord: imported });
    await expect(fixture.expertApi.importExpert("clq-expert", "other-branch")).resolves.toBe(imported.id);
    expect(fixture.calls).toEqual([]);
    expect(fixture.records).toHaveLength(1);
  });

  it("adds the canonical record and keeps the existing id collision rule", async () => {
    const fixture = setup({ records: [record], importedRecord: { ...imported, id: record.id } });
    await expect(fixture.expertApi.importExpert("clq-expert", "main")).resolves.toBe(`${record.id}-main`);
    expect(fixture.records.map((item) => item.id)).toEqual([record.id, `${record.id}-main`]);
    expect(fixture.records[1]?.origin).toEqual(imported.origin);
    expect(fixture.records[1]).not.toHaveProperty("agent");
    expect(fixture.records[1]).not.toHaveProperty("expertPackage");
  });
});
