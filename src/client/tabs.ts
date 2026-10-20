export type Tab = "experts" | "general";

/** Both tabs are always offered: the identity library and its runtime settings. */
export function visibleTabs(): readonly [Tab, ...Tab[]] {
  return ["experts", "general"];
}

/** A chosen tab that is no longer on offer falls back to the first one. */
export function activeTab(chosen: Tab): Tab {
  const tabs = visibleTabs();
  return tabs.includes(chosen) ? chosen : tabs[0];
}
