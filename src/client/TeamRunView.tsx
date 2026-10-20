import { useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, MarkdownText, StateDot, Tag, type StateDotState } from "@deepseek-ai/dsh-client-ui-primitives";
import type { DisagreementResolution, DisagreementType, TeamRun, TeamStage, TeamStageKind } from "../expert-types.js";
import { budgetUsage, clock, groupDisagreements, latestSynthesis, stageColumns, stageLines } from "./team-run-view.js";
import css from "./settings.module.css";

const STAGE_KEYS = {
  brief: "stageBrief",
  analysis: "stageAnalysis",
  "cross-critique": "stageCrossCritique",
  review: "stageReview",
  synthesis: "stageSynthesis",
} as const satisfies Record<TeamStageKind, string>;

const NODE_KEYS = {
  running: "reviewRunning",
  completed: "reviewCompleted",
  failed: "reviewFailed",
  cancelled: "reviewCancelled",
} as const satisfies Record<TeamStage["status"], string>;

const NODE_DOTS = {
  running: "ongoing",
  completed: "done",
  failed: "error",
  cancelled: "idle",
} as const satisfies Record<TeamStage["status"], StateDotState>;

const TYPE_KEYS = {
  fact: "disagreementFact",
  assumption: "disagreementAssumption",
  applicability: "disagreementApplicability",
  value: "disagreementValue",
} as const satisfies Record<DisagreementType, string>;

const RESOLUTION_KEYS = {
  "gather-evidence": "resolutionGatherEvidence",
  experiment: "resolutionExperiment",
  "human-decision": "resolutionHumanDecision",
} as const satisfies Record<DisagreementResolution, string>;

type Labels = { code: { copyLabel: string; copiedLabel: string }; footnotes: string };

function SynthesisSection({ run, t, labels }: { run: TeamRun; t: TranslateNS<"expert-ai">; labels: Labels }): ReactNode {
  const synthesis = latestSynthesis(run);
  if (synthesis === undefined) return <p className={css.muted}>{t("noSynthesis")}</p>;
  return (
    <section className={css.teamRun} aria-label={t("stageSynthesis")}>
      <MarkdownText text={synthesis.summary} labels={labels} />
      {groupDisagreements(synthesis).map((group) => (
        <div key={group.type} className={css.disagreementGroup}>
          <span>
            <Tag tone="info">{t(TYPE_KEYS[group.type])}</Tag>
          </span>
          <ul>
            {group.items.map((item) => (
              <li key={item.topic}>
                <strong>{item.topic}</strong> · {t(RESOLUTION_KEYS[item.resolution])}
                {item.test === undefined ? null : <> · {t("disagreementTest", { test: item.test })}</>}
                <ul>
                  {item.positions.map((position) => (
                    <li key={position.stageId}>
                      {position.stageId}: {position.position}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {synthesis.missingStages.length === 0 ? null : (
        <p className={css.muted}>{t("missingStagesNote", { stages: synthesis.missingStages.join(", ") })}</p>
      )}
    </section>
  );
}

/**
 * Show a v2 team run: status and budget with cancel, the synthesis first, then the stage graph.
 * @returns The run view placed inside the review report dialog.
 */
export function TeamRunView({
  run,
  t,
  labels,
  statusLabel,
  busy,
  onCancel,
}: {
  run: TeamRun;
  t: TranslateNS<"expert-ai">;
  labels: Labels;
  statusLabel: string;
  busy: boolean;
  /** Present only while the run can still be cancelled. */
  onCancel: (() => void) | undefined;
}): ReactNode {
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const usage = budgetUsage(run);
  return (
    <div className={css.teamRun}>
      <div className={css.teamRunHead}>
        <span>
          {statusLabel} · {t("teamRunBudget", usage)}
        </span>
        {onCancel === undefined ? null : (
          <Button size="sm" disabled={busy} onClick={onCancel}>
            {t("cancelReview")}
          </Button>
        )}
      </div>
      {run.error === undefined ? null : (
        <p className={css.error} role="alert">
          {run.error}
        </p>
      )}
      <SynthesisSection run={run} t={t} labels={labels} />
      <ol className={css.stageGraph} aria-label={t("teamRunGraph")}>
        {stageColumns(run).map((column) => (
          <li key={column.kind} className={css.stageColumn}>
            <span className={css.label}>{t(STAGE_KEYS[column.kind])}</span>
            {column.nodes.length === 0 ? <small className={css.muted}>{t("stageSkipped")}</small> : null}
            {column.nodes.map((node) => (
              <button
                key={node.stage.id}
                type="button"
                className={css.stageNode}
                aria-expanded={expanded === node.stage.id}
                onClick={() => {
                  setExpanded(expanded === node.stage.id ? undefined : node.stage.id);
                }}
              >
                <span>
                  <StateDot state={NODE_DOTS[node.stage.status]} /> {node.member?.name ?? node.stage.expertId}
                </span>
                <small>{node.member?.responsibility ?? ""}</small>
                <small>
                  {t(NODE_KEYS[node.stage.status])} · {clock(node.durationMs)}
                  {node.attempts > 1 ? <> · {t("stageAttempts", { count: String(node.attempts) })}</> : null}
                </small>
                {node.stage.error === undefined ? null : <small className={css.error}>{node.stage.error}</small>}
              </button>
            ))}
          </li>
        ))}
      </ol>
      {(() => {
        const stage = run.stages.find((item) => item.id === expanded);
        if (stage === undefined) return null;
        const lines = stageLines(stage);
        return lines.length === 0 ? <p className={css.muted}>{t("stageNoReport")}</p> : <MarkdownText text={lines.join("\n\n")} labels={labels} />;
      })()}
    </div>
  );
}
