import { useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, IconPlayOutlineRegular, SegmentedControl } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ExpertRecord } from "../types.js";
import type { ExpertTeam } from "../expert-types.js";
import type { ExpertWorkbenchApi } from "./ExpertWorkbench.js";
import { MenuSelect, errorText } from "./controls.js";
import { AnalystChecks } from "./TeamEditor.js";
import { MAX_ANALYSTS, requestFromTeam, teamIssues } from "./teams.js";
import css from "./settings.module.css";

/** Whether a review runs a saved team or an ad-hoc lineup. */
export type LaunchMode = "team" | "adhoc";

const BRIEF_LIMIT = 20_000;

/**
 * Pick a lineup and a brief, then ask the Agent to run a plan review.
 * @returns The review launcher block.
 */
export function ReviewLauncher({
  api,
  records,
  teams,
  mode,
  teamId,
  t,
  onModeChange,
  onTeamChange,
  onSaveAsTeam,
  notify,
}: {
  api: Pick<ExpertWorkbenchApi, "startReview">;
  records: readonly ExpertRecord[];
  teams: readonly ExpertTeam[];
  mode: LaunchMode;
  /** Saved team chosen in team mode. */
  teamId: string;
  t: TranslateNS<"expert-ai">;
  onModeChange: (mode: LaunchMode) => void;
  onTeamChange: (id: string) => void;
  /** Open the team editor prefilled with the ad-hoc lineup. */
  onSaveAsTeam: (lineup: Pick<ExpertTeam, "analystIds" | "reviewerId">) => void;
  /** Show a transient confirmation. */
  notify: (text: string) => void;
}): ReactNode {
  const [analystIds, setAnalystIds] = useState<string[]>([]);
  const [reviewerId, setReviewerId] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const enabled = records.filter((record) => record.enabled);
  const enabledIds = new Set(enabled.map((record) => record.id));

  const team = teams.find((item) => item.id === teamId);
  const issues = team === undefined ? [] : teamIssues(team, records);
  // Drop ad-hoc picks whose record was disabled or removed since they were chosen.
  const adhoc = {
    analystIds: analystIds.filter((id) => enabledIds.has(id) && id !== reviewerId),
    reviewerId: enabledIds.has(reviewerId) ? reviewerId : "",
  };
  const adhocReady =
    adhoc.analystIds.length >= 1 && adhoc.analystIds.length <= MAX_ANALYSTS && adhoc.reviewerId !== "";
  const lineup = mode === "team" ? (team !== undefined && issues.length === 0 ? team : undefined) : adhocReady ? adhoc : undefined;
  const canStart = !busy && lineup !== undefined && question.trim() !== "";

  const start = (): void => {
    if (lineup === undefined) return;
    setBusy(true);
    setError(undefined);
    void api
      .startReview(requestFromTeam(lineup, question, mode === "team" ? teamId : undefined))
      .then(() => {
        notify(t("reviewSubmitted"));
      })
      .catch((reason: unknown) => {
        setError(errorText(reason));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className={css.block} aria-labelledby="expert-ai-review-title">
      <div className={css.blockHead}>
        <h3 id="expert-ai-review-title">{t("planReview")}</h3>
        <SegmentedControl<LaunchMode>
          id="expert-ai-launch-mode"
          label={t("launchMode")}
          value={mode}
          options={[
            { value: "team", label: t("launchTeam") },
            { value: "adhoc", label: t("launchAdhoc") },
          ]}
          onChange={onModeChange}
        />
      </div>
      <p className={css.muted}>{t("planReviewHint")}</p>
      {mode === "team" ? (
        teams.length === 0 ? (
          <p className={css.muted}>{t("noTeamsToLaunch")}</p>
        ) : (
          <div className={css.field}>
            <span className={css.label}>{t("chooseTeam")}</span>
            <MenuSelect
              value={teamId}
              placeholder={t("chooseTeam")}
              options={teams.map((item) => ({ value: item.id, label: item.name }))}
              onChange={onTeamChange}
            />
            {issues.length === 0 ? null : (
              <span className={`${css.hint} ${css.fieldError}`}>{t("lineupBlocked")}</span>
            )}
          </div>
        )
      ) : (
        <div className={css.form}>
          <div className={`${css.field} ${css.full}`} role="group" aria-label={t("reviewAnalyst")}>
            <span className={css.label}>{t("reviewAnalyst")}</span>
            <AnalystChecks
              records={enabled}
              selected={adhoc.analystIds}
              excluded={adhoc.reviewerId}
              disabled={busy}
              onToggle={(id, checked) => {
                setAnalystIds(checked ? [...adhoc.analystIds, id] : adhoc.analystIds.filter((item) => item !== id));
              }}
            />
          </div>
          <div className={`${css.field} ${css.full}`}>
            <span className={css.label}>{t("reviewReviewer")}</span>
            <MenuSelect
              value={adhoc.reviewerId}
              placeholder={t("chooseExpert")}
              disabled={busy}
              options={enabled
                .filter((record) => !adhoc.analystIds.includes(record.id))
                .map((record) => ({ value: record.id, label: `${record.name} @${record.id}` }))}
              onChange={setReviewerId}
            />
          </div>
        </div>
      )}
      <label className={css.field}>
        <span className={css.label}>{t("reviewBrief")}</span>
        <textarea
          className={css.textarea}
          rows={5}
          maxLength={BRIEF_LIMIT}
          value={question}
          disabled={busy}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
        />
      </label>
      {error === undefined ? null : (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={css.toolbar}>
        <span className={css.grow} />
        {mode === "adhoc" ? (
          <Button
            variant="outline"
            disabled={!adhocReady}
            onClick={() => {
              onSaveAsTeam(adhoc);
            }}
          >
            {t("saveAsTeam")}
          </Button>
        ) : null}
        <Button variant="primary" icon={<IconPlayOutlineRegular size={16} />} disabled={!canStart} onClick={start}>
          {t("startPlanReview")}
        </Button>
      </div>
    </section>
  );
}
