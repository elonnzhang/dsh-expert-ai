import { describe, expect, it } from "vitest";
import { activeTab, visibleTabs } from "../src/client/tabs.js";

describe("settings tabs", () => {
  it("offers 专家团 only with the conversation feature", () => {
    expect(visibleTabs(true)).toEqual(["experts", "teams", "general"]);
    expect(visibleTabs(false)).toEqual(["experts", "general"]);
  });

  it("keeps the chosen tab while it is on offer", () => {
    expect(activeTab("general", false)).toBe("general");
    expect(activeTab("teams", true)).toBe("teams");
  });

  it("falls back to the first tab when 专家团 goes away", () => {
    expect(activeTab("teams", false)).toBe("experts");
  });
});
