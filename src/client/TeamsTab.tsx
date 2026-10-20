import { useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import {
  Button,
  IconEditOutlineRegular,
  IconPlayOutlineRegular,
  IconPlusOutlineMedium,
  IconTrashOutlineRegular,
  RiskConfirmation,
  Tag,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ConfigForm } from "@deepseek-ai/dsh-client-ui-settings/client";
import type { ExpertRecord, ExpertSettings } from "../types.js";
import type { ExpertTeam } from "../expert-types.js";
import { errorText } from "./controls.js";
import type { ExpertWorkbenchApi } from "./ExpertWorkbench.js";
import { ReviewHistory } from "./ReviewHistory.js";
import { ReviewLauncher, type LaunchMode } from "./ReviewLauncher.js";
import { TeamEditor } from "./TeamEditor.js";
import { teamIssues } from "./teams.js";
import css from "./settings.module.css";

type Editing = { team: ExpertTeam; existing: boolean };

const EMPTY_TEAM: ExpertTeam = { id: "", name: "", purpose: "", analystIds: [], reviewerId: "" };

/**
 * Manage saved expert teams and launch plan reviews with a team or an ad-hoc lineup.
 * @returns The 专家团 tab panel body.
 */
export function TeamsTab({
  records,
  teams,
  writable,
  form,
  expertApi,
  stateDir,
  t,
  notify,
}: {
  records: readonly ExpertRecord[];
  teams: readonly ExpertTeam[];
  writable: boolean;
  form: ConfigForm<ExpertSettings>;
  expertApi: ExpertWorkbenchApi;
  /** Review history is scoped to the state directory; remount it when it changes. */
  stateDir: string;
  t: TranslateNS<"expert-ai">;
  /** Show a transient confirmation. */
  notify: (text: string) => void;
}): ReactNode {
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [deleting, setDeleting] = useState<ExpertTeam | undefined>(undefined);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<LaunchMode>(teams.length === 0 ? "adhoc" : "team");
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const names = new Map(records.map((record) => [record.id, record.name]));
  const nameOf = (id: string): string => names.get(id) ?? `@${id}`;

  const writeTeams = async (next: ExpertTeam[]): Promise<boolean> => form.set("teams", next);
  const save = async (team: ExpertTeam): Promise<string | undefined> => {
    if (editing === undefined) return undefined;
    const editingId = editing.existing ? editing.team.id : undefined;
    const next = editingId === undefined ? [...teams, team] : teams.map((item) => (item.id === editingId ? team : item));
    try {
      if (!(await writeTeams(next))) return t("writeFailed");
    } catch (reason) {
      return errorText(reason);
    }
    setEditing(undefined);
    setTeamId(team.id);
    setMode("team");
    notify(t("teamSaved"));
    return undefined;
  };
  const confirmDelete = (): void => {
    if (deleting === undefined) return;
    setBusy(true);
    void writeTeams(teams.filter((team) => team.id !== deleting.id))
      .then((deleted) => {
        if (!deleted) {
          setError(t("writeFailed"));
          return;
        }
        notify(t("teamDeleted"));
      })
      .catch((reason: unknown) => {
        setError(errorText(reason));
      })
      .finally(() => {
        setBusy(false);
        setDeleting(undefined);
        setAcknowledged(false);
      });
  };

  return (
    <>
      <div className={css.toolbar}>
        <p className={`${css.muted} ${css.grow}`}>{t("teamsHint")}</p>
        <Button
          variant="primary"
          icon={<IconPlusOutlineMedium size={16} />}
          disabled={!writable}
          onClick={() => {
            setError(undefined);
            setEditing({ team: { ...EMPTY_TEAM, analystIds: [] }, existing: false });
          }}
        >
          {t("addTeam")}
        </Button>
      </div>
      {error === undefined ? null : (
        <p className={css.error} role="alert">
          {error}
        </p>
      )}
      <div className={css.list}>
        {teams.length === 0 ? (
          <div className={css.empty}>{t("emptyTeams")}</div>
        ) : (
          teams.map((team) => {
            const issues = teamIssues(team, records);
            return (
              <article className={css.card} key={team.id}>
                <div className={css.cardMain}>
                  <div className={css.identity}>
                    <strong>{team.name}</strong>
                    <code className={css.code}>{team.id}</code>
                    {issues.map((issue) => (
                      <Tag key={issue.id} tone="warning">
                        {t(issue.kind === "missing" ? "issueMissing" : "issueDisabled", { id: issue.id })}
                      </Tag>
                    ))}
                    {records.some((record) => record.id === team.id) ? (
                      <Tag tone="warning">{t("teamIdShadowed", { id: team.id })}</Tag>
                    ) : null}
                  </div>
                  {team.purpose === "" ? null : <p className={css.preview}>{team.purpose}</p>}
                  <p className={css.muted}>
                    {t("teamAnalysts", { names: team.analystIds.map(nameOf).join("、") })} ·{" "}
                    {t("teamReviewer", { name: nameOf(team.reviewerId) })}
                    {team.coordinatorId === undefined ? null : <> · {t("teamCoordinatorName", { name: nameOf(team.coordinatorId) })}</>}
                  </p>
                </div>
                <div className={css.actions}>
                  <Button
                    size="sm"
                    icon={<IconPlayOutlineRegular size={14} />}
                    disabled={issues.length > 0}
                    onClick={() => {
                      setMode("team");
                      setTeamId(team.id);
                      document.getElementById("expert-ai-review-title")?.scrollIntoView({ block: "start" });
                    }}
                  >
                    {t("useTeam")}
                  </Button>
                  <Button
                    size="sm"
                    icon={<IconEditOutlineRegular size={14} />}
                    disabled={!writable}
                    onClick={() => {
                      setError(undefined);
                      setEditing({ team: { ...team, analystIds: [...team.analystIds] }, existing: true });
                    }}
                  >
                    {t("edit")}
                  </Button>
                  <Button
                    size="sm"
                    icon={<IconTrashOutlineRegular size={14} />}
                    disabled={!writable || busy}
                    onClick={() => {
                      setAcknowledged(false);
                      setDeleting(team);
                    }}
                  >
                    {t("remove")}
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>
      <ReviewLauncher
        api={expertApi}
        records={records}
        teams={teams}
        mode={mode}
        teamId={teamId}
        t={t}
        onModeChange={setMode}
        onTeamChange={setTeamId}
        onSaveAsTeam={(lineup) => {
          setError(undefined);
          setEditing({
            team: { ...EMPTY_TEAM, analystIds: [...lineup.analystIds], reviewerId: lineup.reviewerId },
            existing: false,
          });
        }}
        notify={notify}
      />
      <ReviewHistory key={stateDir} api={expertApi} t={t} />
      {editing === undefined ? null : (
        <TeamEditor
          initial={editing.team}
          existing={editing.existing}
          records={records}
          teams={teams}
          t={t}
          onSave={save}
          onCancel={() => {
            setEditing(undefined);
          }}
        />
      )}
      <RiskConfirmation
        open={deleting !== undefined}
        title={t("deleteTeamTitle", { name: deleting?.name ?? "" })}
        description={t("deleteTeamDescription")}
        acknowledgeLabel={t("deleteAcknowledge")}
        cancelLabel={t("cancel")}
        closeLabel={t("close")}
        confirmLabel={t("confirmDelete")}
        acknowledged={acknowledged}
        disabled={busy}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => {
          setDeleting(undefined);
          setAcknowledged(false);
        }}
        onConfirm={confirmDelete}
      />
    </>
  );
}
