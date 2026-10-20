import type { ExpertTeam, ReviewRequest } from "../expert-types.js";
import type { ExpertRecord } from "../types.js";

/** Most analysts one review accepts (mirrors the Host review validator). */
export const MAX_ANALYSTS = 3;

/** Pattern shared by record and team ids. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** A team member that cannot take part in a review right now. */
export interface TeamIssue {
  id: string;
  kind: "missing" | "disabled";
}

/**
 * List the members that block launching a review with this team.
 * @param team Saved lineup.
 * @param records Current digital-life records.
 * @returns Missing or disabled members, analysts first, then reviewer and coordinator.
 */
export function teamIssues(
  team: Pick<ExpertTeam, "analystIds" | "reviewerId" | "coordinatorId">,
  records: readonly Pick<ExpertRecord, "id" | "enabled">[],
): TeamIssue[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return [...new Set([...team.analystIds, team.reviewerId, ...(team.coordinatorId === undefined ? [] : [team.coordinatorId])])].flatMap((id): TeamIssue[] => {
    const record = byId.get(id);
    if (record === undefined) return [{ id, kind: "missing" }];
    return record.enabled ? [] : [{ id, kind: "disabled" }];
  });
}

/**
 * Trim a team draft and drop duplicate analysts and an analyst reused as reviewer.
 * @param draft Team entered in the editor.
 * @returns The team as it is stored.
 */
export function normalizeTeam(draft: ExpertTeam): ExpertTeam {
  const reviewerId = draft.reviewerId.trim();
  const analystIds = [...new Set(draft.analystIds.map((id) => id.trim()))].filter(
    (id) => id !== "" && id !== reviewerId,
  );
  const coordinatorId = draft.coordinatorId?.trim() ?? "";
  const members = new Set([...analystIds, reviewerId, ...(coordinatorId === "" ? [] : [coordinatorId])]);
  // Keep only filled-in duties of people still on the team.
  const responsibilities = Object.fromEntries(
    Object.entries(draft.responsibilities ?? {})
      .map(([id, duty]) => [id.trim(), duty.trim()] as const)
      .filter(([id, duty]) => members.has(id) && duty !== ""),
  );
  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    purpose: draft.purpose.trim(),
    analystIds,
    reviewerId,
    ...(coordinatorId === "" ? {} : { coordinatorId }),
    ...(Object.keys(responsibilities).length === 0 ? {} : { responsibilities }),
    ...(draft.persona?.trim() ? { persona: draft.persona.trim() } : {}),
  };
}

/** Longest member responsibility the Host accepts. */
export const RESPONSIBILITY_LIMIT = 200;

/** Longest team persona the Host accepts. */
export const TEAM_PERSONA_LIMIT = 8_000;

/** Editor field that failed validation. */
export type TeamField = "id" | "name" | "analystIds" | "reviewerId" | "responsibilities" | "persona";

/**
 * Check a normalized team before it is written.
 * @param team Normalized team.
 * @param teams Saved teams.
 * @param editingId Id of the team being edited, if any.
 * @param recordIds Expert ids; a new team id may not shadow one in `@` mentions.
 * @returns The first failing field and its reason, or undefined when valid.
 */
export function teamError(
  team: ExpertTeam,
  teams: readonly ExpertTeam[],
  editingId: string | undefined,
  recordIds: readonly string[],
): { field: TeamField; reason: "required" | "invalidId" | "duplicateId" | "idConflict" | "analystCount" | "responsibilityLength" | "teamPersonaLength" } | undefined {
  if (team.id === "") return { field: "id", reason: "required" };
  if (!ID_PATTERN.test(team.id)) return { field: "id", reason: "invalidId" };
  if (team.id !== editingId && teams.some((item) => item.id === team.id)) return { field: "id", reason: "duplicateId" };
  // Existing conflicts stay editable; the team list warns about them instead.
  if (team.id !== editingId && recordIds.includes(team.id)) return { field: "id", reason: "idConflict" };
  if (team.name === "") return { field: "name", reason: "required" };
  if (team.analystIds.length < 1 || team.analystIds.length > MAX_ANALYSTS)
    return { field: "analystIds", reason: "analystCount" };
  if (team.reviewerId === "") return { field: "reviewerId", reason: "required" };
  if (Object.values(team.responsibilities ?? {}).some((duty) => duty.length > RESPONSIBILITY_LIMIT))
    return { field: "responsibilities", reason: "responsibilityLength" };
  if ((team.persona?.length ?? 0) > TEAM_PERSONA_LIMIT) return { field: "persona", reason: "teamPersonaLength" };
  return undefined;
}

/** What the settings launcher submits: a saved team by id, or an ad-hoc lineup. */
export type LaunchRequest = ReviewRequest & { teamId?: string };

/**
 * Build the request a launch submits.
 * @param lineup Analysts and reviewer.
 * @param question Brief entered by the user.
 * @param teamId Saved team, so the Host uses its coordinator and responsibilities.
 * @returns The request handed to the main agent.
 */
export function requestFromTeam(
  lineup: Pick<ExpertTeam, "analystIds" | "reviewerId">,
  question: string,
  teamId?: string,
): LaunchRequest {
  return {
    question: question.trim(), expertIds: [...lineup.analystIds], reviewerId: lineup.reviewerId,
    ...(teamId === undefined ? {} : { teamId }),
  };
}

/**
 * Teams that reference a record, used to warn before deleting it.
 * @param recordId Record about to be removed.
 * @param teams Saved teams.
 * @returns Teams naming the record as analyst, reviewer, or coordinator.
 */
export function teamsUsing(recordId: string, teams: readonly ExpertTeam[]): ExpertTeam[] {
  return teams.filter((team) => team.reviewerId === recordId || team.analystIds.includes(recordId) || team.coordinatorId === recordId);
}

/**
 * Derive a free team id from its name, falling back to `team`.
 * @param name Team name.
 * @param teams Saved teams.
 * @returns An id matching the record id pattern and unused by `teams`.
 */
export function suggestTeamId(name: string, teams: readonly ExpertTeam[]): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "team";
  const taken = new Set(teams.map((team) => team.id));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/** One `@` candidate: an expert, or a saved team. */
export interface MentionCandidate {
  name: string;
  description: string;
  kind: "expert" | "team";
}

/**
 * Rank `@` candidates: experts first, then saved teams whose id no expert already uses.
 * @param records Enabled digital-life records.
 * @param teams Saved teams.
 * @param query Text typed after `@`.
 * @returns Matching candidates.
 */
export function mentionCandidates(
  records: readonly Pick<ExpertRecord, "id" | "name" | "description" | "tags">[],
  teams: readonly ExpertTeam[],
  query: string,
): MentionCandidate[] {
  const needle = query.toLowerCase();
  const matches = (text: string): boolean => text.toLowerCase().includes(needle);
  const experts = records
    .filter((item) => matches(`${item.id} ${item.name} ${item.description} ${item.tags.join(" ")}`))
    .map((item): MentionCandidate => ({ name: item.id, description: `${item.name} · ${item.description}`, kind: "expert" }));
  const taken = new Set(records.map((item) => item.id));
  const saved = teams
    .filter((team) => !taken.has(team.id) && matches(`${team.id} ${team.name} ${team.purpose}`))
    .map((team): MentionCandidate => ({
      name: team.id, description: team.purpose === "" ? team.name : `${team.name} · ${team.purpose}`, kind: "team",
    }));
  return [...experts, ...saved];
}
