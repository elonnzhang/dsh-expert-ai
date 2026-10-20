import { useEffect, useState, useSyncExternalStore } from "react";
import type { PropsRuntime, TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import type { ObservableSnapshot } from "@deepseek-ai/dsh-client-store";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  IconAgentPresetOutlineMedium,
  IconChevronDownOutlineMedium,
  IconUserOutlineMedium,
  Menu,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ExpertRecord } from "../types.js";
import css from "./AgentPresetSelector.module.css";
import { categoryLabel } from "./locales.js";

/** Display metadata for one selectable Agent preset. */
export interface AgentPresetOption {
  id: string;
  name: string;
  description?: string;
}

/** Callbacks and records injected by the Client installer. */
export interface AgentPresetSelectorInjected {
  /** `team` names the expert team hosting the session when no digital life is bound. */
  load: () => Promise<{ options: AgentPresetOption[]; current: string; life?: string; team?: string }>;
  select: (id: string) => Promise<void>;
  records: () => readonly ExpertRecord[];
  selectLife: (id: string) => Promise<void>;
  developerTools: ObservableSnapshot<boolean>;
  t: TranslateNS<"expert-ai">;
}

export type AgentPresetSelectorProps =
  PropsRuntime<"conversation.hero.agentPreset"> & AgentPresetSelectorInjected;

/** Render the Harness-styled Agent preset and expert-ai selectors. */
export function AgentPresetSelector({
  load,
  select,
  records,
  selectLife,
  developerTools,
  t,
}: AgentPresetSelectorProps) {
  const developerToolsEnabled = useSyncExternalStore(
    developerTools.subscribe,
    developerTools.getSnapshot,
    developerTools.getSnapshot,
  );
  const [options, setOptions] = useState<AgentPresetOption[]>([]);
  const [current, setCurrent] = useState("");
  const [life, setLife] = useState("");
  const [team, setTeam] = useState("");
  const [presetOpen, setPresetOpen] = useState(false);
  const [lifeOpen, setLifeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>();

  useEffect(() => {
    if (!developerToolsEnabled) {
      setOptions([]);
      setCurrent("");
      setLife("");
      setTeam("");
      setLoadError(undefined);
      return;
    }
    void load()
      .then((value) => {
        setOptions(value.options);
        setCurrent(value.current);
        setLife(value.life ?? "");
        setTeam(value.team ?? "");
        setLoadError(undefined);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setLoadError(message);
        console.error("expert-ai: failed to load agent presets", error);
      });
  }, [developerToolsEnabled, load]);

  const chosen = options.find((option) => option.id === current);
  const chosenLife = records().find((record) => record.id === life);
  if (!developerToolsEnabled) return null;
  if (options.length === 0) {
    return loadError === undefined ? null : <div className={css.error} role="alert">{loadError}</div>;
  }
  const presetName = chosen?.name ?? current;

  return (
    <div className={css.root}>
      <Menu
        className={`${css.seatWrap} ${css.presetWrap}`}
        open={presetOpen}
        onClose={() => {
          setPresetOpen(false);
        }}
        items={options.map((option) => ({
          id: option.id,
          label: (
            <span className={css.item}>
              <span className={css.itemName}>{option.name}</span>
              <span className={css.itemDesc}>
                {option.description ?? t("presetNoDescription")}
              </span>
            </span>
          ),
        }))}
        selectedId={current}
        onSelect={(id) => {
          setPresetOpen(false);
          const previous = current;
          setBusy(true);
          void select(id)
            .then(() => {
              setCurrent(id);
              if (id !== "expert-ai-mode") {
                setLife("");
                setTeam("");
              }
            })
            .catch((error: unknown) => {
              setCurrent(previous);
              console.error("expert-ai: failed to select agent preset", error);
            })
            .finally(() => setBusy(false));
        }}
        align="start"
        portal
        anchor={
          <button
            type="button"
            className={css.seat}
            aria-haspopup="menu"
            aria-expanded={presetOpen}
            title={presetName}
            disabled={busy}
            onClick={() => {
              setPresetOpen((value) => !value);
            }}
          >
            <IconAgentPresetOutlineMedium className={css.icon} />
            <span className={css.seatLabel}>{presetName}</span>
            <IconChevronDownOutlineMedium className={css.chevron} />
          </button>
        }
      />
      {current === "expert-ai-mode" && (
        <Menu
          className={`${css.seatWrap} ${css.lifeWrap}`}
          open={lifeOpen}
          onClose={() => {
            setLifeOpen(false);
          }}
          items={records().map((record) => ({
            id: record.id,
            label: (
              <span className={css.item}>
                <span className={css.itemName}>{record.name}</span>
                <span className={css.itemDesc}>
                  {record.description} · {categoryLabel(record, t)}
                </span>
              </span>
            ),
          }))}
          selectedId={life}
          onSelect={(id) => {
            setLifeOpen(false);
            void selectLife(id)
              .then(() => {
                setLife(id);
                setTeam("");
              })
              .catch((error) => {
                console.error("expert-ai: failed to select digital life", error);
              });
          }}
          align="start"
          portal
          anchor={
            <button
              type="button"
              className={css.seat}
              aria-haspopup="menu"
              aria-expanded={lifeOpen}
              title={life === "" ? (team === "" ? t("chooseLifeRequired") : team) : chosenLife?.name}
              onClick={() => {
                setLifeOpen((value) => !value);
              }}
            >
              <IconUserOutlineMedium className={css.icon} />
              <span className={css.seatLabel}>
                {chosenLife?.name ?? (team === "" ? t("chooseLife") : team)}
              </span>
              <IconChevronDownOutlineMedium className={css.chevron} />
            </button>
          }
        />
      )}
    </div>
  );
}
