import { useState, type ReactNode } from "react";
import type { PropsRuntime, TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import {
  IconSlidersTwoOutlineRegular,
  IconUserOutlineRegular,
  SegmentedTabs,
  Toast,
  type SegmentedTab,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ConfigForm, ConfigFormSnapshot } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ExpertSettings } from "../types.js";
import type { ExpertLibraryApi } from "./library-api.js";
import { ExpertsTab } from "./ExpertsTab.js";
import { GeneralTab } from "./GeneralTab.js";
import css from "./settings.module.css";

export { normalizeExpertRecord } from "./records.js";

/** Config form and reactive source injected into the settings section. */
export interface ExpertSettingSectionInjected {
  hooks: {
    settings: {
      getSnapshot(): ConfigFormSnapshot<ExpertSettings>;
      subscribe(listener: () => void): () => void;
    };
  };
  form: ConfigForm<ExpertSettings>;
  loadIdentity: (id: string) => Promise<string>;
  expertApi: ExpertLibraryApi;
  t: TranslateNS<"expert-ai">;
}

type Props = PropsRuntime<"settings.section"> & {
  useSettings: <T>(selector: (snapshot: ConfigFormSnapshot<ExpertSettings>) => T) => T;
} & Omit<ExpertSettingSectionInjected, "hooks">;

type Tab = "experts" | "general";

const tabIds = (value: Tab): Pick<SegmentedTab<Tab>, "id" | "panelId"> => ({
  id: `expert-ai-tab-${value}`,
  panelId: `expert-ai-panel-${value}`,
});

const tabLabel = (icon: ReactNode, text: string): ReactNode => (
  <span className={css.tabLabel}>
    {icon}
    {text}
  </span>
);

/** Render the expert-ai settings as 专家 / 通用设置 tabs. */
export function ExpertSettingSection(props: Props): ReactNode {
  const t = props.t;
  const snapshot = props.useSettings((value) => value);
  const [tab, setTab] = useState<Tab>("experts");
  const [toast, setToast] = useState<{ text: string; key: number } | undefined>(undefined);
  const settings = snapshot.value;

  if (snapshot.status === "loading")
    return (
      <section className={css.section}>
        <p className={css.muted}>{t("loading")}</p>
      </section>
    );
  if (snapshot.status !== "ready" || settings === undefined) {
    return (
      <section className={css.section}>
        <header className={css.header}>
          <h2>{t("title")}</h2>
          <p>{t("unavailable")}</p>
        </header>
      </section>
    );
  }

  const records = (settings.records ?? []).map((record) => ({
    ...record,
    description: record.description?.trim() || record.name,
    tags: record.tags ?? (record.tag?.trim() ? [record.tag.trim()] : []),
  }));
  const notify = (text: string): void => {
    setToast({ text, key: Date.now() });
  };
  const items: readonly [SegmentedTab<Tab>, ...SegmentedTab<Tab>[]] = [
    { value: "experts", label: tabLabel(<IconUserOutlineRegular size={16} />, t("tabExperts")), ...tabIds("experts") },
    { value: "general", label: tabLabel(<IconSlidersTwoOutlineRegular size={16} />, t("tabGeneral")), ...tabIds("general") },
  ];

  return (
    <section className={css.section}>
      <header className={css.header}>
        <h2>{t("title")}</h2>
        <p>{t("intro")}</p>
      </header>
      <SegmentedTabs items={items} value={tab} onChange={setTab} label={t("tabsLabel")} />
      <div
        className={css.panel}
        role="tabpanel"
        id={tabIds(tab).panelId}
        aria-labelledby={tabIds(tab).id}
        tabIndex={0}
      >
        {tab === "experts" ? (
          <ExpertsTab
            records={records}
            writable={snapshot.writable}
            form={props.form}
            loadIdentity={props.loadIdentity}
            expertApi={props.expertApi}
            t={t}
            notify={notify}
          />
        ) : (
          <GeneralTab form={props.form} t={t} />
        )}
      </div>
      {toast === undefined ? null : (
        <Toast
          key={toast.key}
          text={toast.text}
          tone="success"
          onDone={() => {
            setToast(undefined);
          }}
        />
      )}
    </section>
  );
}
