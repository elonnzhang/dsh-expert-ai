import { useEffect, useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  IconDownloadOutlineRegular,
  IconRefreshOutlineRegular,
  MarkdownText,
  Modal,
  StateDot,
  type StateDotState,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { AnyReviewRun, ReviewSummary } from "../expert-types.js";
import type { ExpertWorkbenchApi } from "./ExpertWorkbench.js";
import { TeamRunView } from "./TeamRunView.js";
import { errorText } from "./controls.js";
import css from "./settings.module.css";

const STATUS_KEYS = {
  open: "reviewOpen",
  running: "reviewRunning",
  completed: "reviewCompleted",
  partial: "reviewPartial",
  failed: "reviewFailed",
  cancelled: "reviewCancelled",
  "timed-out": "reviewTimedOut",
  expired: "reviewExpired",
} as const satisfies Record<ReviewSummary["status"], string>;

const STATUS_DOTS = {
  open: "ongoing",
  running: "ongoing",
  completed: "done",
  partial: "warning",
  failed: "error",
  cancelled: "idle",
  "timed-out": "warning",
  expired: "idle",
} as const satisfies Record<ReviewSummary["status"], StateDotState>;

const POLL_MS = 2_000;

type Report = { run: AnyReviewRun; markdown: string };

/** Statuses that still allow cancel and keep the list polling. */
const LIVE: ReadonlySet<ReviewSummary["status"]> = new Set(["open", "running"]);
const briefOf = (run: AnyReviewRun): string => (run.schemaVersion === 2 ? run.briefs[0]?.text ?? "" : run.request.question);

/**
 * List past plan reviews, poll while any is running, and open or export reports.
 * @returns The review history block.
 */
export function ReviewHistory({
  api,
  t,
}: {
  api: Pick<ExpertWorkbenchApi, "listReviews" | "readReview" | "cancelReview" | "openReviewSession">;
  t: TranslateNS<"expert-ai">;
}): ReactNode {
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [report, setReport] = useState<Report | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const hasRunning = reviews.some((run) => LIVE.has(run.status));

  useEffect(() => {
    let mounted = true;
    const refresh = (): void => {
      void api
        .listReviews()
        .then((value) => {
          if (mounted) setReviews(value);
        })
        .catch((reason: unknown) => {
          if (mounted) setError(errorText(reason));
        });
    };
    refresh();
    const timer = hasRunning ? setInterval(refresh, POLL_MS) : undefined;
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [api, hasRunning]);

  const reportLive = report !== undefined && LIVE.has(report.run.status);
  const reportId = report?.run.id;
  useEffect(() => {
    if (!reportLive || reportId === undefined) return;
    const timer = setInterval(() => {
      void api.readReview(reportId).then(setReport).catch((reason: unknown) => {
        setError(errorText(reason));
      });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [api, reportLive, reportId]);

  const perform = (action: () => Promise<void>): void => {
    setBusy(true);
    setError(undefined);
    void action()
      .catch((reason: unknown) => {
        setError(errorText(reason));
      })
      .finally(() => {
        setBusy(false);
      });
  };
  const download = (kind: "md" | "json"): void => {
    if (report === undefined) return;
    const blob = new Blob([kind === "md" ? report.markdown : JSON.stringify(report.run, null, 2)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${report.run.id}.${kind}`;
    anchor.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1_000);
  };
  const cancel = (id: string): void => {
    perform(async () => {
      await api.cancelReview(id);
      setReviews(await api.listReviews());
      if (report?.run.id === id) setReport(await api.readReview(id));
    });
  };

  const labels = { code: { copyLabel: t("copyCode"), copiedLabel: t("copiedCode") }, footnotes: t("footnotes") };
  return (
    <section className={css.block} aria-labelledby="expert-ai-history-title">
      <div className={css.blockHead}>
        <h3 id="expert-ai-history-title">{t("reviewHistory")}</h3>
        <Button
          size="sm"
          icon={<IconRefreshOutlineRegular size={14} />}
          disabled={busy}
          onClick={() => {
            perform(async () => {
              setReviews(await api.listReviews());
            });
          }}
        >
          {t("refreshReviews")}
        </Button>
      </div>
      {error === undefined ? null : (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      {reviews.length === 0 ? (
        <p className={css.muted}>{t("noReviews")}</p>
      ) : (
        <div>
          {reviews.map((run) => (
            <div className={css.reviewRow} key={run.id}>
              <StateDot state={STATUS_DOTS[run.status]} />
              <div className={css.reviewMain}>
                <span title={run.question}>{run.question}</span>
                <small>
                  {t(STATUS_KEYS[run.status])} · {new Date(run.createdAt).toLocaleString()}
                </small>
              </div>
              {LIVE.has(run.status) ? (
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    cancel(run.id);
                  }}
                >
                  {t("cancelReview")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  api.openReviewSession(run.sessionId);
                }}
              >
                {t("enterSession")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  perform(async () => {
                    setReport(await api.readReview(run.id));
                  });
                }}
              >
                {t("openReport")}
              </Button>
            </div>
          ))}
        </div>
      )}
      {report === undefined ? null : (
        <Modal
          open
          onClose={() => {
            setReport(undefined);
          }}
          title={t("reportTitle")}
          description={briefOf(report.run)}
          closeLabel={t("close")}
          className={css.dialog ?? ""}
          contentClassName={css.dialogContent ?? ""}
          footer={
            <>
              <Button
                variant="outline"
                icon={<IconDownloadOutlineRegular size={16} />}
                onClick={() => {
                  download("md");
                }}
              >
                {t("exportReviewMarkdown")}
              </Button>
              <Button
                variant="outline"
                icon={<IconDownloadOutlineRegular size={16} />}
                onClick={() => {
                  download("json");
                }}
              >
                {t("exportReviewJson")}
              </Button>
            </>
          }
        >
          {report.run.schemaVersion === 2 ? (
            <TeamRunView
              run={report.run}
              t={t}
              labels={labels}
              statusLabel={t(STATUS_KEYS[report.run.status])}
              busy={busy}
              onCancel={LIVE.has(report.run.status) ? () => { cancel(report.run.id); } : undefined}
            />
          ) : (
            <MarkdownText text={report.markdown} labels={labels} />
          )}
        </Modal>
      )}
    </section>
  );
}
