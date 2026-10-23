import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Session } from "@deepseek-ai/dsh-session";
import { normalizeRecord } from "../src/record-model.js";
import {
  appendOpeningAssistantMessage,
  compileChatPlan,
  deleteBinding,
  identityRevision,
  loadBinding,
  saveBinding,
} from "../src/host/runtime/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), "expert-ai-binding-"));
  roots.push(value);
  return value;
}

const record = normalizeRecord({
  id: "mentor", name: "导师", description: "创业", category: "business", tags: [], persona: "关注现金流。",
  toolFilter: ["read_file"], enabled: true,
});

describe("expert-ai session binding", () => {
  it("appends the opening assistant message without an agent request", () => {
    const session = Session.create("session-opening" as never);
    appendOpeningAssistantMessage(session, "欢迎开始");
    appendOpeningAssistantMessage(session, "欢迎开始");
    expect(session.deriveMessages()).toHaveLength(1);
    expect(session.deriveMessages()[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "欢迎开始" }],
      source: { provider: "expert-ai", model: "opening" },
    });
    expect(session.snapshotEvents().map((event) => event.type)).toEqual([
      "turn/start", "step/start", "assistant/message", "step/end", "turn/end",
    ]);
  });

  it("saves a compiled plan and reads it back unchanged", async () => {
    const dir = await root();
    const plan = compileChatPlan(record, "关注现金流。");
    await saveBinding("session-1234", plan, dir);
    expect(await loadBinding("session-1234", dir)).toEqual({ plan, legacy: false });
    expect(plan.revision).toBe(identityRevision("关注现金流。"));
    expect(plan.policy).toEqual({ sandbox: "read-only", tools: ["read_file"] });
    await deleteBinding("session-1234", dir);
    expect(await loadBinding("session-1234", dir)).toBeUndefined();
  });

  it("rejects session ids that could leave the sessions directory", async () => {
    const plan = compileChatPlan(record, "x");
    await expect(saveBinding("../other", plan, await root())).rejects.toThrow(/invalid session id/);
  });

  it("accepts unprefixed UUID sessions created by the Harness spawn provider", async () => {
    const dir = await root();
    const id = "64e6f29a-0464-4db3-8909-ec50e14f93d9";
    expect(await loadBinding(id, dir)).toBeUndefined();
    await saveBinding(id, compileChatPlan(record, "x"), dir);
    expect((await loadBinding(id, dir))?.plan.expertId).toBe("mentor");
  });

  it.each([
    ["split", { recordId: "mentor", pre: "Header", persona: "Persona", suf: "Rules" }, ["Header", "Persona", "Rules"]],
    ["single-text", { recordId: "mentor", prompt: "Old prompt" }, ["Old prompt"]],
  ])("reads a %s binding as a plan that keeps the saved prompt", async (_label, saved, texts) => {
    const dir = await root();
    await mkdir(join(dir, "expert-ai", "sessions"), { recursive: true });
    await writeFile(join(dir, "expert-ai", "sessions", "session-old.json"), JSON.stringify(saved));
    const loaded = await loadBinding("session-old", dir);
    expect(loaded?.legacy).toBe(true);
    expect(loaded?.plan.expertId).toBe("mentor");
    expect(loaded?.plan.policy).toEqual({ sandbox: "read-only" });
    expect(loaded?.plan.sections.map((section) => section.name)[0]).toBe("expert-ai:source");
    expect(loaded?.plan.sections.slice(1).map((section) => section.text)).toEqual(texts);
  });

  it("opens a session an expert team hosted unbound, and rejects a damaged binding", async () => {
    const dir = await root();
    const sessions = join(dir, "expert-ai", "sessions");
    await mkdir(sessions, { recursive: true });
    await writeFile(join(sessions, "session-team.json"), JSON.stringify({ team: "t" }));
    expect(await loadBinding("session-team", dir)).toBeUndefined();
    await writeFile(join(sessions, "session-bad.json"), JSON.stringify({ recordId: "mentor", pre: "x" }));
    await expect(loadBinding("session-bad", dir)).rejects.toThrow(/invalid binding/);
    expect(JSON.parse(await readFile(join(sessions, "session-bad.json"), "utf8"))).toEqual({ recordId: "mentor", pre: "x" });
  });
});
