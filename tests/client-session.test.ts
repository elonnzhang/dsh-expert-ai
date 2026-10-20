import { describe, expect, it, vi } from "vitest";
import type { Context } from "@deepseek-ai/cordis";
import type { SessionId } from "@deepseek-ai/dsh-session/types";
import type { ChatPanelInjected } from "../src/client/ChatPanel.js";
import type { ExpertRecord } from "../src/types.js";

vi.mock("../src/client/ChatPanel.js", () => ({ ChatPanel: () => null }));
vi.mock("../src/client/ExpertSettingSection.js", () => ({ ExpertSettingSection: () => null }));
vi.mock("@deepseek-ai/dsh-client-ui-primitives", () => ({ IconUsersOutlineMedium: () => null }));

const { apply, inject } = await import("../src/client/index.js");

const record: ExpertRecord = {
  id: "research-guide",
  name: "Research Guide",
  description: "Research help",
  category: "science",
  tags: [],
  persona: "Research carefully",
  enabled: true,
};

function setup(options: { records?: ExpertRecord[]; status?: "loading" | "ready" | "unavailable" } = {}) {
  const calls: string[] = [];
  let configuredRecords = options.records ?? [record];
  const formStatus = options.status ?? "ready";
  const formListeners = new Set<() => void>();
  const activeSlots = new Map<symbol, string>();
  const payloads = new Map<string, unknown>();
  let promptContent: unknown;
  const sessionId = "session-1" as SessionId;
  let createSession: ChatPanelInjected["createSession"] | undefined;
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
      connection: {
        rpc: {
          call: async (channel: string, method: string, payload?: unknown) => {
            if (channel !== "/api" || !method.startsWith("expert-ai/")) throw new Error(`unexpected RPC target ${channel}/${method}`);
            const endpoint = method.slice("expert-ai/".length);
            calls.push(endpoint);
            payloads.set(endpoint, payload);
            if (endpoint === "project") return { ok: true, value: { cwd: "/tmp/expert-ai/projects/test" } };
            return { ok: true, value: {} };
          },
        },
      },
    })[service as "sessions" | "connection"],
    effect: (install: () => unknown) => install(),
    locale: { register: () => () => {}, bind: () => (key: string) => key },
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
    get records() { return configuredRecords; },
    get promptContent() { return promptContent; },
  };
}

describe("expert-ai single-expert conversations", () => {
  it("declares only the services a settings page and a conversation need", () => {
    expect(inject).toEqual(["slots", "connection", "configForms", "locale", "sessions", "uiWorkspace"]);
  });

  it("registers the settings section and the sidebar entry, nothing else", () => {
    expect(setup().slots()).toEqual(["settings.section", "sidebar.footer.action"]);
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
