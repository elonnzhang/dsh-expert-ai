import { describe, expect, it } from "vitest";
import { mountWhile } from "../src/client/feature-gate.js";
import type { ExpertFeature } from "../src/types.js";

type Status = "loading" | "ready" | "unavailable";

const snapshot = (status: Status, features?: ExpertFeature[]) => ({
  status,
  value: status === "ready" ? { ...(features === undefined ? {} : { features }) } : undefined,
  base: undefined,
  user: undefined,
  revision: 1,
  writable: true,
  mode: "host" as const,
});

function setup(initial: ReturnType<typeof snapshot>) {
  let current = initial;
  const listeners = new Set<() => void>();
  const form = {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const log = { mounts: 0, unmounts: 0 };
  const stop = mountWhile(form as never, "conversation", () => {
    log.mounts += 1;
    return () => { log.unmounts += 1; };
  });
  return {
    log,
    stop,
    listeners,
    publish(next: ReturnType<typeof snapshot>) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("mountWhile", () => {
  it("mounts nothing while the setting is still loading", () => {
    const fixture = setup(snapshot("loading"));
    expect(fixture.log).toEqual({ mounts: 0, unmounts: 0 });
    fixture.publish(snapshot("ready", ["identity", "conversation"]));
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("stays off when the feature is missing from the list", () => {
    expect(setup(snapshot("ready", ["identity"])).log.mounts).toBe(0);
    expect(setup(snapshot("ready", [])).log.mounts).toBe(0);
  });

  it("stays off for a Host that reports no features at all", () => {
    expect(setup(snapshot("ready")).log.mounts).toBe(0);
  });

  it("stays off when the settings are unavailable", () => {
    expect(setup(snapshot("unavailable")).log.mounts).toBe(0);
  });

  it("mounts once however often the snapshot changes", () => {
    const fixture = setup(snapshot("ready", ["identity", "conversation"]));
    fixture.publish(snapshot("ready", ["identity", "conversation"]));
    fixture.publish(snapshot("ready", ["conversation", "identity"]));
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("unmounts when turned off and mounts again when turned back on", () => {
    const fixture = setup(snapshot("ready", ["identity", "conversation"]));
    fixture.publish(snapshot("ready", ["identity"]));
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 1 });
    fixture.publish(snapshot("ready", ["identity", "conversation"]));
    expect(fixture.log).toEqual({ mounts: 2, unmounts: 1 });
  });

  it("unmounts when the settings become unavailable", () => {
    const fixture = setup(snapshot("ready", ["identity", "conversation"]));
    fixture.publish(snapshot("unavailable"));
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 1 });
  });

  it("treats a stale value as off once the status is no longer ready", () => {
    const stale = { ...snapshot("ready", ["identity", "conversation"]), status: "unavailable" as const };
    expect(setup(stale).log.mounts).toBe(0);
    const fixture = setup(snapshot("ready", ["identity", "conversation"]));
    fixture.publish(stale);
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 1 });
  });

  it("keeps what is mounted while a snapshot reloads", () => {
    const fixture = setup(snapshot("ready", ["identity", "conversation"]));
    fixture.publish(snapshot("loading"));
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 0 });
  });

  it("unmounts and stops listening when disposed", () => {
    const fixture = setup(snapshot("ready", ["identity", "conversation"]));
    fixture.stop();
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 1 });
    expect(fixture.listeners.size).toBe(0);
    fixture.publish(snapshot("ready", ["identity", "conversation"]));
    expect(fixture.log).toEqual({ mounts: 1, unmounts: 1 });
  });
});
