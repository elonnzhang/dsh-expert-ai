import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Session } from "@deepseek-ai/dsh-session";
import { appendOpeningAssistantMessage } from "../src/host/index.js";
import { loadBinding, preserveLegacyBinding, saveBinding } from "../src/host/session-binding.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
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
      "turn/start",
      "step/start",
      "assistant/message",
      "step/end",
      "turn/end",
    ]);
  });

  it("restores the selected identity across host restarts", async () => {
    const root = await mkdtemp(join(tmpdir(), "expert-ai-binding-"));
    roots.push(root);
    const sessionId = "session-1234";
    const binding = { recordId: "research-guide", pre: "Header", persona: "Be a researcher", suf: "Rules" };

    expect(await loadBinding(sessionId, root)).toBeUndefined();
    await saveBinding(sessionId, binding, root);
    expect(await loadBinding(sessionId, root)).toEqual(binding);
    expect(JSON.parse(await readFile(join(root, "expert-ai", "sessions", `${sessionId}.json`), "utf8"))).toEqual(binding);
  });

  it("opens a session left by a removed expert team unbound and still rejects ownerless bindings", async () => {
    const root = await mkdtemp(join(tmpdir(), "expert-ai-binding-"));
    roots.push(root);
    const dir = join(root, "expert-ai", "sessions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "session-team.json"), JSON.stringify({ team: { id: "plan-review", name: "方案评审" }, pre: "Header", persona: "Host", suf: "Rules" }));
    expect(await loadBinding("session-team", root)).toBeUndefined();
    await writeFile(join(dir, "session-none.json"), JSON.stringify({ pre: "", persona: "x", suf: "" }));
    await expect(loadBinding("session-none", root)).rejects.toThrow(/invalid binding/);
  });

  it("rejects paths outside the managed session directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "expert-ai-binding-"));
    roots.push(root);
    await expect(saveBinding("../other", { recordId: "life", pre: "", persona: "text", suf: "" }, root)).rejects.toThrow(/invalid session id/);
  });

  it("accepts unprefixed UUID sessions created by the Harness spawn provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "expert-ai-binding-"));
    roots.push(root);
    const id = "64e6f29a-0464-4db3-8909-ec50e14f93d9";
    expect(await loadBinding(id, root)).toBeUndefined();
    const binding = { recordId: "mentor", pre: "", persona: "Method", suf: "" };
    await saveBinding(id, binding, root);
    expect(await loadBinding(id, root)).toEqual(binding);
  });

  it("still reads bindings saved before the prompt was split", async () => {
    const root = await mkdtemp(join(tmpdir(), "expert-ai-binding-"));
    roots.push(root);
    const sessionId = "session-legacy";
    await mkdir(join(root, "expert-ai", "sessions"), { recursive: true });
    await writeFile(join(root, "expert-ai", "sessions", `${sessionId}.json`), JSON.stringify({ recordId: "mentor", prompt: "Old" }));
    expect(await loadBinding(sessionId, root)).toEqual({ recordId: "mentor", prompt: "Old" });
    await writeFile(join(root, "expert-ai", "sessions", `${sessionId}.json`), JSON.stringify({ recordId: "mentor", pre: "x" }));
    await expect(loadBinding(sessionId, root)).rejects.toThrow(/invalid binding/);
  });

  it("preserves the saved identity when upgrading a legacy binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "expert-ai-binding-"));
    roots.push(root);
    const legacy = { recordId: "mentor", prompt: "Original identity and rules" };
    const upgraded = preserveLegacyBinding(legacy);
    expect(upgraded).toEqual({ recordId: "mentor", pre: legacy.prompt, persona: "", suf: "" });
    await saveBinding("session-legacy", upgraded, root);
    expect(await loadBinding("session-legacy", root)).toEqual(upgraded);
  });
});
