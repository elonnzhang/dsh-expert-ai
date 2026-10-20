import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PropsRuntime, TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  IconChevronRightOutlineMedium,
  IconRefreshOutlineRegular,
  IconSearchOutlineRegular,
  StateDot,
  Tag,
  type StateDotState,
} from "@deepseek-ai/dsh-client-ui-primitives";
import { IconThinkOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ReviewSummary } from "../expert-types.js";
import type { ExpertTeam } from "../expert-types.js";
import type { ExpertRecord } from "../types.js";
import { categoryLabel } from "./locales.js";
import { ReviewHistory } from "./ReviewHistory.js";
import { ReviewLauncher, type LaunchMode } from "./ReviewLauncher.js";
import type { ExpertWorkbenchApi } from "./ExpertWorkbench.js";
import { errorText } from "./controls.js";
import css from "./settings.module.css";

const LIVE_STATUSES = new Set<ReviewSummary["status"]>(["open", "running"]);

function statusMeta(status: ReviewSummary["status"], labels: ExpertAIPanelProps["t"]): { label: string; tone: "done" | "ongoing" | "error" | "warning" | "idle" } {
  const keys: Record<ReviewSummary["status"], Parameters<typeof labels>[0]> = {
    open: "reviewOpen",
    running: "reviewRunning",
    completed: "reviewCompleted",
    partial: "reviewPartial",
    failed: "reviewFailed",
    cancelled: "reviewCancelled",
    "timed-out": "reviewTimedOut",
    expired: "reviewExpired",
  };
  const tones: Record<ReviewSummary["status"], "done" | "ongoing" | "error" | "warning" | "idle"> = {
    open: "ongoing", running: "ongoing", completed: "done", partial: "warning",
    failed: "error", cancelled: "idle", "timed-out": "warning", expired: "idle",
  };
  return { label: labels(keys[status]), tone: tones[status] };
}

/** Sidebar glyph for the Expert AI panel row. */
export function ExpertAIPanelIcon({ size }: PropsRuntime<"sidebar.panellist">): ReactNode {
  return <IconThinkOutlineRegular size={size} />;
}

export interface ExpertAIPanelInjected {
  /** Enabled expert records shown in the launcher. */
  records: () => readonly ExpertRecord[];
  /** Saved lineups shown in the launcher. */
  teams: () => readonly ExpertTeam[];
  /** Host-backed expert workbench operations. */
  expertApi: ExpertWorkbenchApi;
  t: TranslateNS<"digital-life">;
}

export type ExpertAIPanelProps = PropsRuntime<"main"> & ExpertAIPanelInjected;

/** Full-width Expert AI workbench; the Expert AI sidebar entry opens it. */
export function ExpertAIPanel({ records, teams, expertApi, t }: ExpertAIPanelProps): ReactNode {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [mode, setMode] = useState<LaunchMode>(teams().length === 0 ? "adhoc" : "team");
  const [teamId, setTeamId] = useState(teams()[0]?.id ?? "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notify, setNotify] = useState<{ text: string; key: number } | undefined>(undefined);
  const [runningCount, setRunningCount] = useState(0);

  const showNotify = (text: string): void => {
    setNotify({ text, key: Date.now() });
  };
  useEffect(() => {
    if (notify === undefined) return;
    const timer = window.setTimeout(() => {
      setNotify(undefined);
    }, 2_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notify]);

  const allRecords = records();
  const categories = useMemo(
    () => [...new Set(allRecords.map((record) => record.category))],
    [allRecords],
  );
  const needle = query.trim().toLowerCase();
  const visible = allRecords.filter((record) =>
    (category === "all" || record.category === category) &&
    (needle === "" || `${record.name} ${record.id} ${record.description} ${record.tags.join(" ")}`.toLowerCase().includes(needle)));
  const counts = {
    records: allRecords.length,
    teams: teams().length,
    running: runningCount,
  };

  return (
    <section className={css.expertSurface} aria-label={t("expertAiPanel")}>
      <header className={css.expertHero}>
        <div>
          <p className={css.expertEyebrow}>{t("expertAiPanel")}</p>
          <h1>{t("expertSurfaceTitle")}</h1>
          <p>{t("expertSurfaceIntro")}</p>
        </div>
        <dl className={css.expertMetrics}>
          <div><dt>{t("expertMetricExperts")}</dt><dd>{String(counts.records)}</dd></div>
          <div><dt>{t("expertMetricTeams")}</dt><dd>{String(counts.teams)}</dd></div>
          <div><dt>{t("expertMetricRunning")}</dt><dd>{String(counts.running)}</dd></div>
        </dl>
      </header>

      <div className={css.expertColumns}>
        <div className={css.expertMain}>
          <ReviewLauncher
            api={expertApi}
            records={allRecords}
            teams={[...teams()]}
            mode={mode}
            teamId={teamId}
            t={t}
            onModeChange={setMode}
            onTeamChange={setTeamId}
            onSaveAsTeam={() => {
              showNotify(t("expertTeamEditorHint"));
            }}
            notify={showNotify}
          />
        </div>

        <aside className={css.expertSide}>
          <div className={css.block}>
            <div className={css.blockHead}>
              <h3>{t("tabExperts")}</h3>
              <Tag tone="neutral">{String(allRecords.length)}</Tag>
            </div>
            <div className={css.toolbar}>
              <InputSearch
                value={query}
                onChange={setQuery}
                placeholder={t("searchRecords")}
                ariaLabel={t("searchRecords")}
              />
              {categories.length < 2 ? null : (
                <select
                  className={css.expertSelect}
                  value={category}
                  aria-label={t("category")}
                  onChange={(event) => {
                    setCategory(event.target.value);
                  }}
                >
                  <option value="all">{t("filterAll")}</option>
                  {categories.map((value) => (
                    <option key={value} value={value}>{value === "custom" ? t("categoryCustom") : categoryLabel({ category: value }, t)}</option>
                  ))}
                </select>
              )}
            </div>
            <div className={css.expertMiniList}>
              {visible.length === 0 ? (
                <p className={css.muted}>{t("noMatches")}</p>
              ) : visible.slice(0, 6).map((record) => (
                <button
                  key={record.id}
                  type="button"
                  className={css.expertMiniRow}
                  onClick={() => {
                    setQuery(record.name);
                    showNotify(t("expertLauncherFocus"));
                  }}
                >
                  <span className={css.expertAvatar} aria-hidden>{record.name.slice(0, 1)}</span>
                  <span className={css.expertMiniMain}>
                    <strong>{record.name}</strong>
                    <small>{record.description}</small>
                  </span>
                  <IconChevronRightOutlineMedium size={14} />
                </button>
              ))}
            </div>
          </div>

          <div className={css.block}>
            <div className={css.blockHead}>
              <h3>{t("expertRecent")}</h3>
              <RecentReviewBadge expertApi={expertApi} t={t} onRunningChange={setRunningCount} />
            </div>
            <RecentReviews
              expertApi={expertApi}
              t={t}
              onOpenHistory={() => {
                setHistoryOpen(true);
              }}
            />
          </div>
        </aside>
      </div>

      {historyOpen ? (
        <div className={css.expertHistoryLayer} role="presentation">
          <div className={css.expertHistoryCard}>
            <div className={css.blockHead}>
              <h3>{t("reviewHistory")}</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setHistoryOpen(false);
                }}
              >
                {t("close")}
              </Button>
            </div>
            <ReviewHistory api={expertApi} t={t} />
          </div>
        </div>
      ) : null}

      {notify === undefined ? null : (
        <div className={css.expertToast} role="status">{notify.text}</div>
      )}
    </section>
  );
}

function InputSearch({ value, onChange, placeholder, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}): ReactNode {
  return (
    <label className={css.expertSearch}>
      <IconSearchOutlineRegular size={14} aria-hidden />
      <input
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function RecentReviewBadge({ expertApi, t, onRunningChange }: {
  expertApi: Pick<ExpertWorkbenchApi, "listReviews">;
  t: ExpertAIPanelProps["t"];
  onRunningChange: (count: number) => void;
}): ReactNode {
  const [running, setRunning] = useState(0);
  useEffect(() => {
    let mounted = true;
    const refresh = (): void => {
      void expertApi.listReviews().then((reviews) => {
        if (!mounted) return;
        const next = reviews.filter((review) => LIVE_STATUSES.has(review.status)).length;
        setRunning(next);
        onRunningChange(next);
      }).catch(() => {});
    };
    refresh();
    const timer = running === 0 ? window.setInterval(refresh, 8_000) : window.setInterval(refresh, 2_000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [expertApi, running, onRunningChange]);
  return <Tag tone={running > 0 ? "info" : "neutral"}>{t(running > 0 ? "expertRunning" : "expertIdle")}</Tag>;
}

function RecentReviews({ expertApi, t, onOpenHistory }: {
  expertApi: Pick<ExpertWorkbenchApi, "listReviews" | "readReview" | "cancelReview" | "openReviewSession">;
  t: ExpertAIPanelProps["t"];
  onOpenHistory: () => void;
}): ReactNode {
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const refresh = (): void => {
    setBusy(true);
    void expertApi.listReviews().then((value) => {
      setReviews(value.slice(0, 4));
      setError(undefined);
    }).catch((reason: unknown) => {
      setError(errorText(reason));
    }).finally(() => {
      setBusy(false);
    });
  };
  useEffect(refresh, [expertApi]);

  return (
    <>
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      {reviews.length === 0 ? (
        <p className={css.muted}>{t("noReviews")}</p>
      ) : (
        <div className={css.expertMiniList}>
          {reviews.map((review) => {
            const status = statusMeta(review.status, t);
            return (
              <div key={review.id} className={css.expertReviewRow}>
                <StateDot state={status.tone as StateDotState} />
                <div className={css.expertMiniMain}>
                  <strong title={review.question}>{review.question}</strong>
                  <small>{status.label} · {new Date(review.createdAt).toLocaleString()}</small>
                </div>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                  expertApi.openReviewSession(review.sessionId);
                }}>
                  {t("enterSession")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => {
                  onOpenHistory();
                }}>
                  {t("openReport")}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <Button
        variant="outline"
        icon={<IconRefreshOutlineRegular size={16} />}
        disabled={busy}
        onClick={refresh}
      >
        {t("refreshReviews")}
      </Button>
    </>
  );
}
