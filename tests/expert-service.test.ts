import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ToolExecution } from "@deepseek-ai/dsh-tools";
import type { ExpertRecord } from "../src/types.js";
import { createExpertService } from "../src/host/expert-service.js";
import { packageBinding, packageFetcher } from "./expert-fixture.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const records: ExpertRecord[] = [{ id: "analyst", name: "analyst", description: "analyst", category: "science", tags: [], persona: "Method analyst", enabled: true }];
type RegisteredTool = { name: string; execute: (args: unknown, exec: ToolExecution) => Promise<unknown> };

async function fixture() {
  const stateDir = await mkdtemp(join(tmpdir(), "expert-service-test-"));
  roots.push(stateDir);
  const registered = new Map<string, RegisteredTool>();
  const parent = { id: "session-fixture", ctx: {
    tools: {
      register: (tool: RegisteredTool) => { registered.set(tool.name, tool); return () => registered.delete(tool.name); },
    },
  } } as unknown as Agent;
  const service = createExpertService({ current: () => ({ provider: "spawn", records }), stateDir: () => stateDir });
  const unregister = service.registerTools(parent);
  const exec = { agent: parent, signal: new AbortController().signal } as ToolExecution;
  return { stateDir, registered, service, exec, unregister };
}

describe("expert Host service", () => {
  it("lists and imports experts by branch, keeping the commit internal", async () => {
    const f = await fixture();
    const files = packageFetcher();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) =>
      String(input).startsWith("https://api.github.com/") ? new Response(packageBinding.revision) : files(input, init)));
    try {
      expect(await f.service.rpc("expert/catalog", { ref: " main " })).toMatchObject({
        ok: true, value: { ref: "main", cached: false, experts: [{ slug: "test-expert" }] },
      });
      const imported = await f.service.rpc("expert/import", { slug: "test-expert", ref: "main" });
      expect(imported).toMatchObject({ ok: true, value: { record: { expertPackage: { ...packageBinding, ref: "main" } } } });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("registers only the reference tool and withdraws it", async () => {
    const f = await fixture();
    expect([...f.registered.keys()]).toEqual(["read_expert_reference"]);
    await expect(f.registered.get("read_expert_reference")!.execute({ id: "analyst" }, f.exec)).rejects.toThrow(/no imported package/);
    await expect(f.registered.get("read_expert_reference")!.execute({ id: "missing" }, f.exec)).rejects.toThrow(/not found/);
    f.unregister();
    expect(f.registered.size).toBe(0);
  });

  it("returns structured errors for malformed and removed endpoints", async () => {
    const f = await fixture();
    expect(await f.service.rpc("expert/catalog", null)).toMatchObject({ ok: false });
    expect(await f.service.rpc("expert/catalog", { ref: "../main" })).toMatchObject({ ok: false });
    expect(await f.service.rpc("expert/import", { slug: "test-expert", ref: "feature/" })).toMatchObject({ ok: false });
    for (const endpoint of ["review/list", "review/read", "review/cancel"])
      expect(await f.service.rpc(endpoint, {})).toMatchObject({ ok: false, error: { message: expect.stringContaining("unknown expert endpoint") } });
  });
});
