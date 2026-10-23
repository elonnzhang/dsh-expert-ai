import type { ExpertRecord } from "../../types.js";
import {
  normalizeRecord,
  recordProblems,
  storedRecord,
} from "../../record-model.js";

export { ID_PATTERN } from "../../record-model.js";

/** Draft a new record starts from. */
export const EMPTY_RECORD: ExpertRecord = {
  id: "",
  name: "",
  description: "",
  category: "business",
  customCategory: "",
  tags: [],
  persona: "",
  origin: { kind: "managed" },
  enabled: true,
};

function normalizeConsultation(draft: ExpertRecord): ExpertRecord {
  const provider = draft.model?.provider?.trim() ?? "";
  const model = draft.model?.model?.trim() ?? "";
  const tools = [
    ...new Set(
      (draft.toolFilter ?? [])
        .map((tool) => tool.trim())
        .filter(Boolean),
    ),
  ];
  const { model: _model, toolFilter: _toolFilter, ...rest } = draft;
  return {
    ...rest,
    ...(provider === "" && model === ""
      ? {}
      : { model: { ...(provider === "" ? {} : { provider }), ...(model === "" ? {} : { model }) } }),
    ...(tools.length === 0 ? {} : { toolFilter: tools }),
  };
}

/**
 * Resolve an editor draft to the canonical record shape written to settings.
 * @param draft Record entered in the settings editor.
 * @returns A canonical record with `origin` set and legacy fields removed.
 */
export function normalizeExpertRecord(draft: ExpertRecord): ExpertRecord {
  return storedRecord(normalizeRecord(normalizeConsultation(draft)));
}

/** Rewrite every record in a settings list into the canonical shape. */
export function normalizeExpertRecords(records: readonly ExpertRecord[]): ExpertRecord[] {
  return records.map(normalizeExpertRecord);
}

/**
 * Convert a read-only pack or file identity into an editable managed identity.
 * The identity body is already loaded into `persona` by the settings tab.
 */
export function copyAsManaged(draft: ExpertRecord): ExpertRecord {
  const {
    agent: _agent,
    expertPackage: _package,
    tag: _tag,
    ...rest
  } = draft;
  return normalizeExpertRecord({
    ...rest,
    origin: { kind: "managed" },
  });
}

/** Why an editor draft cannot be saved, and which fields to mark. */
export interface RecordProblem {
  reason:
    | "required"
    | "invalidId"
    | "duplicateId"
    | "titleLength"
    | "sourceNoteLength"
    | "sourceKindInvalid"
    | "avatarInvalid"
    | "originInvalid";
  fields: Set<string>;
}

function editorReason(code: string): RecordProblem["reason"] {
  switch (code) {
    case "required":
    case "invalidId":
    case "duplicateId":
    case "titleLength":
    case "sourceNoteLength":
      return code;
    case "sourceKind":
      return "sourceKindInvalid";
    case "avatar":
      return "avatarInvalid";
    default:
      return "originInvalid";
  }
}

/**
 * Check an editor draft before it is written.
 * @param draft Record entered in the editor.
 * @param ids Ids of the saved records.
 * @param editingId Id of the record being edited, if any.
 * @returns The problem blocking the save, or undefined when valid.
 */
export function recordProblem(
  draft: ExpertRecord,
  ids: ReadonlySet<string>,
  editingId: string | undefined,
): RecordProblem | undefined {
  // New external records are edited as `origin.path`; the shared model also
  // understands the legacy `agent` field, so mirror it for validation.
  const candidate =
    draft.origin?.kind === "file" && draft.agent === undefined
      ? { ...draft, agent: draft.origin.path }
      : draft;
  const problems = recordProblems(candidate, { editor: true });
  if (problems.length > 0) {
    return {
      reason: editorReason(problems[0]!.code),
      fields: new Set(problems.map((problem) => problem.field)),
    };
  }
  const id = normalizeRecord(candidate).id;
  if (editingId !== id && ids.has(id)) return { reason: "duplicateId", fields: new Set(["id"]) };
  return undefined;
}
