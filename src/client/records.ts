import { MAX_EXPERT_SOURCE_NOTE_LENGTH, MAX_EXPERT_TITLE_LENGTH } from "../constants.js";
import type { ExpertRecord } from "../types.js";
import { ID_PATTERN } from "./teams.js";

/** Draft a new record starts from. */
export const EMPTY_RECORD: ExpertRecord = {
  id: "",
  name: "",
  description: "",
  category: "business",
  customCategory: "",
  tags: [],
  persona: "",
  enabled: true,
};

/**
 * Resolve the identity source stored for an editor draft.
 * @param draft Record entered in the settings editor.
 * @returns A record bound to either its managed Markdown file or an external Agent file.
 */
export function normalizeExpertRecord(draft: ExpertRecord): ExpertRecord {
  const { title: rawTitle, avatar, source: rawSource, ...rest } = draft;
  const agent = draft.agent?.trim() ?? "";
  const id = draft.id.trim();
  const title = rawTitle?.trim();
  const note = rawSource?.note?.trim();
  const managedBinding = `${id}/agents/${id}.md`;
  const managed = agent === "" || agent === managedBinding;
  return {
    ...rest,
    ...(title ? { title } : {}),
    // An empty `avatar:` or `source:` in YAML reaches the form as null.
    ...(avatar == null ? {} : { avatar }),
    ...(rawSource == null ? {} : { source: { kind: rawSource.kind, ...(note ? { note } : {}) } }),
    id,
    name: draft.name.trim(),
    description: draft.description.trim(),
    ...(draft.customCategory?.trim() ? { customCategory: draft.customCategory.trim() } : {}),
    tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
    agent: managed ? managedBinding : agent,
    persona: managed ? draft.persona.trim() : "",
  };
}

/** Why an editor draft cannot be saved, and which fields to mark. */
export interface RecordProblem {
  reason: "required" | "invalidId" | "duplicateId" | "titleLength" | "sourceNoteLength";
  fields: Set<string>;
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
  const id = draft.id.trim();
  const missing = new Set<string>();
  if (id === "") missing.add("id");
  if (draft.name.trim() === "") missing.add("name");
  if (draft.description.trim() === "") missing.add("description");
  if (draft.category === "custom" && draft.description.trim().length < 2) missing.add("description");
  if (draft.tags.some((tag) => tag.trim() === "")) missing.add("tags");
  if (draft.category === "custom" && (draft.customCategory?.trim().length ?? 0) < 2) missing.add("customCategory");
  // A record must either provide inline identity text or an explicit Host
  // agent path. A browser-selected file is imported into `persona`; it must
  // not be sent back as a filename that the Host cannot read.
  if (draft.persona.trim() === "" && (draft.agent?.trim() ?? "") === "") missing.add("persona");
  if (missing.size > 0) return { reason: "required", fields: missing };
  if (!ID_PATTERN.test(id)) return { reason: "invalidId", fields: new Set(["id"]) };
  if (editingId !== id && ids.has(id)) return { reason: "duplicateId", fields: new Set(["id"]) };
  if ((draft.title?.trim().length ?? 0) > MAX_EXPERT_TITLE_LENGTH)
    return { reason: "titleLength", fields: new Set(["title"]) };
  if ((draft.source?.note?.trim().length ?? 0) > MAX_EXPERT_SOURCE_NOTE_LENGTH)
    return { reason: "sourceNoteLength", fields: new Set(["source"]) };
  return undefined;
}
