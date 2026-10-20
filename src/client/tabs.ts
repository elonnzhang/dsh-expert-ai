export type Tab = "experts" | "teams" | "general";

/** 专家团, with its review launcher, exists only while the conversation feature is on. */
export function visibleTabs(conversation: boolean): readonly [Tab, ...Tab[]] {
  return conversation ? ["experts", "teams", "general"] : ["experts", "general"];
}

/** A chosen tab that is no longer on offer falls back to the first one. */
export function activeTab(chosen: Tab, conversation: boolean): Tab {
  const tabs = visibleTabs(conversation);
  return tabs.includes(chosen) ? chosen : tabs[0];
}
