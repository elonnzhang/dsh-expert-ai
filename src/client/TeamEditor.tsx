import { useState, type ReactNode } from "react";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import { Button, Checkbox, Input, Modal } from "@deepseek-ai/dsh-client-ui-primitives";
import type { ExpertRecord } from "../types.js";
import type { ExpertTeam } from "../expert-types.js";
import { MenuSelect } from "./controls.js";
import { MAX_ANALYSTS, RESPONSIBILITY_LIMIT, TEAM_PERSONA_LIMIT, normalizeTeam, suggestTeamId, teamError, type TeamField } from "./teams.js";
import css from "./settings.module.css";

const REASON_KEYS = {
  required: "required",
  invalidId: "invalidId",
  duplicateId: "duplicateId",
  analystCount: "analystCount",
  idConflict: "teamIdConflict",
  responsibilityLength: "responsibilityLength",
  teamPersonaLength: "teamPersonaLength",
} as const;
const BY_REVIEWER = "__reviewer__";

/**
 * Add or edit one expert team in a dialog.
 * @returns The team editor dialog.
 */
export function TeamEditor({
  initial,
  existing,
  records,
  teams,
  t,
  onSave,
  onCancel,
}: {
  /** Team to edit, or a prefilled lineup for a new team. */
  initial: ExpertTeam;
  /** Whether the team is already saved; its id is then fixed. */
  existing: boolean;
  records: readonly ExpertRecord[];
  teams: readonly ExpertTeam[];
  t: TranslateNS<"digital-life">;
  /** Persist the team; resolves to an error message, or undefined once saved. */
  onSave: (team: ExpertTeam) => Promise<string | undefined>;
  onCancel: () => void;
}): ReactNode {
  const [draft, setDraft] = useState(initial);
  // A new team's id follows its name until the user types an id.
  const [idTouched, setIdTouched] = useState(existing || initial.id !== "");
  const [invalid, setInvalid] = useState<TeamField | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  const update = (patch: Partial<ExpertTeam>, field?: TeamField): void => {
    setDraft((current) => ({ ...current, ...patch }));
    if (field !== undefined && field === invalid) setInvalid(undefined);
  };
  const toggleAnalyst = (id: string, checked: boolean): void => {
    update(
      { analystIds: checked ? [...draft.analystIds, id] : draft.analystIds.filter((item) => item !== id) },
      "analystIds",
    );
  };
  const save = (): void => {
    const team = normalizeTeam(draft);
    const problem = teamError(team, teams, existing ? initial.id : undefined, records.map((record) => record.id));
    if (problem !== undefined) {
      setInvalid(problem.field);
      setError(
        problem.field === "reviewerId" && problem.reason === "required"
          ? t("reviewerRequired")
          : problem.reason === "required"
            ? t("required")
            : t(REASON_KEYS[problem.reason]),
      );
      return;
    }
    setSaving(true);
    setError(undefined);
    void onSave(team)
      .then((message) => {
        if (message !== undefined) setError(message);
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const controlClass = (field: TeamField): string => `${css.control} ${invalid === field ? css.invalid : ""}`;

  return (
    <Modal
      open
      onClose={onCancel}
      title={existing ? t("dialogEditTeam") : t("dialogAddTeam")}
      closeLabel={t("close")}
      className={css.dialog ?? ""}
      contentClassName={css.dialogContent ?? ""}
      footer={
        <>
          {error === undefined ? null : (
            <span className={`${css.error} ${css.grow}`} role="alert">
              {error}
            </span>
          )}
          <Button variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? t("saving") : t("save")}
          </Button>
        </>
      }
    >
      <div className={css.form}>
        <label className={css.field}>
          <span className={css.label}>{t("teamName")}</span>
          <Input
            className={controlClass("name")}
            value={draft.name}
            placeholder={t("teamNamePlaceholder")}
            data-modal-autofocus=""
            onChange={(event) => {
              const name = event.target.value;
              update(idTouched ? { name } : { name, id: suggestTeamId(name, teams) }, "name");
            }}
          />
        </label>
        <label className={css.field}>
          <span className={css.label}>{t("teamId")}</span>
          <Input
            className={controlClass("id")}
            value={draft.id}
            placeholder="team"
            disabled={existing}
            readOnly={existing}
            onChange={(event) => {
              setIdTouched(true);
              update({ id: event.target.value }, "id");
            }}
          />
        </label>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t("teamPurpose")}</span>
          <Input
            className={css.control ?? ""}
            value={draft.purpose}
            placeholder={t("teamPurposePlaceholder")}
            onChange={(event) => {
              update({ purpose: event.target.value });
            }}
          />
        </label>
        <label className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t("teamPersona")}</span>
          <textarea
            className={`${css.textarea} ${invalid === "persona" ? css.invalid : ""}`}
            rows={6}
            maxLength={TEAM_PERSONA_LIMIT}
            value={draft.persona ?? ""}
            placeholder={t("teamPersonaPlaceholder")}
            onChange={(event) => {
              update({ persona: event.target.value }, "persona");
            }}
          />
          <span className={css.hint}>{t("teamPersonaHint")}</span>
        </label>
        <div className={`${css.field} ${css.full}`} role="group" aria-label={t("reviewAnalyst")}>
          <span className={css.label}>{t("reviewAnalyst")}</span>
          <AnalystChecks
            records={records}
            selected={draft.analystIds}
            excluded={draft.reviewerId}
            onToggle={toggleAnalyst}
          />
          <span className={`${css.hint} ${invalid === "analystIds" ? css.fieldError : ""}`}>
            {t("analystLimit")}
          </span>
        </div>
        <div className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t("reviewReviewer")}</span>
          <MenuSelect
            value={draft.reviewerId}
            placeholder={t("chooseExpert")}
            invalid={invalid === "reviewerId"}
            options={records
              .filter((record) => !draft.analystIds.includes(record.id))
              .map((record) => ({ value: record.id, label: `${record.name} @${record.id}` }))}
            onChange={(reviewerId) => {
              update({ reviewerId }, "reviewerId");
            }}
          />
        </div>
        <div className={`${css.field} ${css.full}`}>
          <span className={css.label}>{t("teamCoordinator")}</span>
          <MenuSelect
            // Menu item ids must be non-empty, so "reviewer doubles as coordinator" uses a sentinel.
            value={draft.coordinatorId ?? BY_REVIEWER}
            placeholder={t("coordinatorByReviewer")}
            options={[
              { value: BY_REVIEWER, label: t("coordinatorByReviewer") },
              ...records.map((record) => ({ value: record.id, label: `${record.name} @${record.id}` })),
            ]}
            onChange={(coordinatorId) => {
              const { coordinatorId: _previous, ...rest } = draft;
              setDraft(coordinatorId === BY_REVIEWER ? rest : { ...rest, coordinatorId });
            }}
          />
        </div>
        <div className={`${css.field} ${css.full}`} role="group" aria-label={t("teamResponsibilities")}>
          <span className={css.label}>{t("teamResponsibilities")}</span>
          {[...new Set([...draft.analystIds, draft.reviewerId, draft.coordinatorId ?? ""])]
            .filter((id) => id !== "")
            .map((id) => (
              <Input
                key={id}
                className={controlClass("responsibilities")}
                aria-label={t("responsibilityFor", { id })}
                value={draft.responsibilities?.[id] ?? ""}
                maxLength={RESPONSIBILITY_LIMIT}
                placeholder={t("responsibilityPlaceholder", { id })}
                onChange={(event) => {
                  update({ responsibilities: { ...draft.responsibilities, [id]: event.target.value } }, "responsibilities");
                }}
              />
            ))}
          <span className={`${css.hint} ${invalid === "responsibilities" ? css.fieldError : ""}`}>
            {t("responsibilityHint")}
          </span>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Checkbox grid choosing up to {@link MAX_ANALYSTS} analysts.
 * @returns One checkbox per record; the reviewer and, once full, unchecked records are disabled.
 */
export function AnalystChecks({
  records,
  selected,
  excluded,
  disabled = false,
  onToggle,
}: {
  records: readonly ExpertRecord[];
  selected: readonly string[];
  /** Record already chosen as reviewer. */
  excluded: string;
  disabled?: boolean;
  onToggle: (id: string, checked: boolean) => void;
}): ReactNode {
  const full = selected.length >= MAX_ANALYSTS;
  return (
    <div className={css.checks}>
      {records.map((record) => {
        const checked = selected.includes(record.id);
        return (
          <Checkbox
            key={record.id}
            checked={checked}
            label={`${record.name} @${record.id}`}
            disabled={disabled || record.id === excluded || (!checked && full)}
            onChange={(next) => {
              onToggle(record.id, next);
            }}
          />
        );
      })}
    </div>
  );
}
