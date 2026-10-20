import { describe, expect, it } from "vitest";
import { activeTab, visibleTabs } from "../src/client/tabs.js";

describe("settings tabs", () => {
  it("offers the expert library and general settings, with no 专家团 tab", () => {
    expect(visibleTabs()).toEqual(["experts", "general"]);
  });

  it("keeps the chosen tab while it is on offer", () => {
    expect(activeTab("general")).toBe("general");
    expect(activeTab("experts")).toBe("experts");
  });

  it("falls back to the first tab for a tab that is no longer offered", () => {
    expect(activeTab("teams" as never)).toBe("experts");
  });
});
