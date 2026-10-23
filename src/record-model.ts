/**
 * The one place that turns a saved expert record into its canonical shape and says
 * why it cannot be stored. Pure, so the Host settings validation and the Client editor
 * apply exactly the same rules. See docs/plans/2026-10-21-identity-and-runtime.md.
 */
import { avatarProblem } from "./avatar.js";
import {
  EXPERT_ORIGIN_KINDS,
  EXPERT_SOURCE_KINDS,
  MAX_EXPERT_SOURCE_NOTE_LENGTH,
  MAX_EXPERT_TITLE_LENGTH,
} from "./constants.js";
import type { ExpertPackageBinding } from "./expert-types.js";
import type { CanonicalExpertRecord, ExpertOrigin, ExpertRecord } from "./types.js";

/** Pattern every record id must match. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
export const PACKAGE_SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
export const PACKAGE_REVISION = /^[a-f0-9]{40}$/;
const PACKAGE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/;
/**
 * A bundled pack directory inside the plugin package. It may sit directly under
 * `experts/` (`experts/ELON`) or in any nested folder (`experts/xingtu/ELON`,
 * `experts/xingtu/team/ELON`). Folder names keep their case; the manifest id stays lowercase.
 */
export const BUNDLED_PATH = /^experts(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;
/** How records saved before `origin` named a bundled pack. */
const LEGACY_BUNDLED_AGENT = /^(experts(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+)\/AGENTS\.md$/i;

/** Normalize a user-entered bundled directory without changing its case. */
export function normalizeBundledPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/\/+$/, "");
}

/** The managed identity file of a record, relative to the plugin data directory. */
export function managedAgentPath(id: string): string {
  return `${id}/agents/${id}.md`;
}

/** Where an imported package keeps its identity, relative to the plugin data directory. */
export function packageAgentPath(binding: Pick<ExpertPackageBinding, "source" | "revision" | "slug">): string {
  return `${binding.source}/${binding.slug}/AGENTS.md`;
}

/** Read compatibility for packages imported before source/slug storage. */
export function legacyPackageAgentPath(binding: Pick<ExpertPackageBinding, "source" | "revision" | "slug">): string {
  return `.expert-packages/${binding.source}/${binding.revision}/${binding.slug}/AGENTS.md`;
}

export function validPackageRef(value: string): boolean {
  return PACKAGE_REF.test(value) && !value.includes("..") && !value.endsWith("/") && !value.endsWith(".lock");
}

/** Read the origin a record declares, or derive it from the fields saved before `origin` existed. */
export function originOf(record: Pick<ExpertRecord, "id" | "origin" | "agent" | "expertPackage">): ExpertOrigin {
  if (record.origin != null) {
    const origin = record.origin;
    if (origin.kind === "package" && typeof origin.ref !== "string") return { ...origin, ref: origin.revision };
    if (origin.kind === "file") return { kind: origin.kind, path: origin.path.trim() };
    if (origin.kind === "bundled") return { kind: origin.kind, path: normalizeBundledPath(origin.path) };
    return origin;
  }
  if (record.expertPackage != null) {
    const { source, slug, revision } = record.expertPackage;
    // Packages imported before the branch or tag was recorded were pinned to a commit.
    const ref = typeof record.expertPackage.ref === "string" ? record.expertPackage.ref : revision;
    return { kind: "package", source, slug, revision, ref };
  }
  const agent = record.agent?.trim() ?? "";
  if (agent === "" || agent === managedAgentPath(record.id.trim())) return { kind: "managed" };
  const bundled = LEGACY_BUNDLED_AGENT.exec(agent);
  if (bundled !== null) return { kind: "bundled", path: bundled[1]! };
  return { kind: "file", path: agent };
}

/**
 * Migrate and normalize one record. Legacy fields are dropped, text is trimmed, an empty
 * `avatar:` or `source:` (YAML null) reads as absent, and only a managed record keeps `persona`.
 */
export function normalizeRecord(record: ExpertRecord): CanonicalExpertRecord {
  const {
    title: rawTitle, avatar, source: rawSource, agent: _agent, expertPackage: _package, tag, origin: _origin,
    customCategory: rawCustom, ...rest
  } = record;
  const origin = originOf(record);
  const name = record.name.trim();
  const title = rawTitle?.trim();
  const note = rawSource?.note?.trim();
  const custom = rawCustom?.trim();
  const tags = [...new Set((record.tags.length > 0 ? record.tags : tag === undefined ? [] : [tag]).map((item) => item.trim()))]
    .filter(Boolean);
  return {
    ...rest,
    id: record.id.trim(),
    name,
    ...(title ? { title } : {}),
    description: record.description.trim() || name,
    ...(record.category === "custom" ? { customCategory: custom || name } : custom ? { customCategory: custom } : {}),
    tags,
    persona: origin.kind === "managed" ? record.persona.trim() : "",
    origin,
    ...(avatar == null ? {} : { avatar }),
    ...(rawSource == null ? {} : { source: { kind: rawSource.kind, ...(note ? { note } : {}) } }),
  };
}

/** A field of a record that can block saving it, as the editor marks it. */
export type RecordField = "id" | "name" | "description" | "tags" | "customCategory" | "title" | "source" | "avatar" | "persona" | "origin";

export type RecordProblemCode =
  | "required"
  | "invalidId"
  | "duplicateId"
  | "titleLength"
  | "sourceKind"
  | "sourceNoteLength"
  | "avatar"
  | "origin";

/** One reason a record cannot be stored. `message` is English and names the record. */
export interface RecordProblem {
  field: RecordField;
  code: RecordProblemCode;
  message: string;
}

function originProblem(origin: ExpertOrigin): string | undefined {
  if (!(EXPERT_ORIGIN_KINDS as readonly string[]).includes(origin.kind))
    return `origin kind must be one of ${EXPERT_ORIGIN_KINDS.join(", ")}`;
  if (origin.kind === "file" && origin.path === "") return "agent cannot be empty";
  if (origin.kind === "bundled" && !BUNDLED_PATH.test(origin.path))
    return "bundled origin must name a directory under experts/";
  if (origin.kind === "package") {
    if (origin.source !== "mimeographs" || !PACKAGE_SLUG.test(origin.slug) || !PACKAGE_REVISION.test(origin.revision))
      return "invalid expert package; use a slug and a full lowercase commit SHA";
    if (!validPackageRef(origin.ref)) return "invalid expert package; a branch or tag is required";
  }
  return undefined;
}

export interface RecordCheckOptions {
  /**
   * The settings editor always holds the managed body in `persona`, so an empty one is a
   * missing field there. The Host instead accepts a managed record without `persona` when
   * it declares its origin, because the managed file is the source.
   */
  editor?: boolean;
}

/**
 * Every reason one record cannot be stored, in field order. A record's own problems only;
 * duplicate ids across records come from {@link settingsProblems}.
 */
export function recordProblems(raw: ExpertRecord, options: RecordCheckOptions = {}): RecordProblem[] {
  const record = normalizeRecord(raw);
  const of = `for "${record.id}"`;
  const problems: RecordProblem[] = [];
  const add = (field: RecordField, code: RecordProblemCode, message: string): void => {
    problems.push({ field, code, message: `expert-ai: ${message}` });
  };
  if (record.id === "") add("id", "required", "id is required");
  else if (!ID_PATTERN.test(record.id)) add("id", "invalidId", `id "${record.id}" must match ${String(ID_PATTERN)}`);
  if (record.name === "") add("name", "required", `name is required ${of}`);
  if (raw.description.trim() === "" && record.name === "") add("description", "required", `description is required ${of}`);
  if (raw.tags.some((tag) => tag.trim() === "")) add("tags", "required", `tags cannot be empty ${of}`);
  if (record.category === "custom" && (record.customCategory?.length ?? 0) < 2)
    add("customCategory", "required", `custom category requires a meaningful customCategory ${of}`);
  if ((record.title?.length ?? 0) > MAX_EXPERT_TITLE_LENGTH)
    add("title", "titleLength", `title must contain at most ${String(MAX_EXPERT_TITLE_LENGTH)} characters ${of}`);
  if (record.source !== undefined) {
    if (!(EXPERT_SOURCE_KINDS as readonly string[]).includes(record.source.kind))
      add("source", "sourceKind", `source kind must be one of ${EXPERT_SOURCE_KINDS.join(", ")} ${of}`);
    else if ((record.source.note?.length ?? 0) > MAX_EXPERT_SOURCE_NOTE_LENGTH)
      add("source", "sourceNoteLength", `source note must contain at most ${String(MAX_EXPERT_SOURCE_NOTE_LENGTH)} characters ${of}`);
  }
  const avatar = record.avatar === undefined ? undefined : avatarProblem(record.avatar);
  if (avatar !== undefined) add("avatar", "avatar", `avatar: ${avatar} ${of}`);
  const origin = originProblem(record.origin);
  if (origin !== undefined) add("origin", "origin", `${origin} ${of}`);
  // An inline-only record (no origin, no legacy agent path) has nowhere else to keep its body.
  const declared = raw.origin != null || (raw.agent?.trim() ?? "") !== "";
  if (record.origin.kind === "managed" && record.persona === "" && (options.editor === true || !declared))
    add("persona", "required", `persona is required unless agent is set ${of}`);
  // A record saved before `origin` must not relabel another file as its immutable package.
  if (raw.origin == null && raw.expertPackage != null && raw.agent !== undefined &&
      raw.agent !== packageAgentPath(raw.expertPackage) && raw.agent !== legacyPackageAgentPath(raw.expertPackage))
    add("origin", "origin", "imported expert identity must stay bound to its immutable package");
  return problems;
}

/** Every reason a settings document cannot be stored, including duplicate ids. */
export function settingsProblems(records: readonly ExpertRecord[]): RecordProblem[] {
  const seen = new Set<string>();
  const problems: RecordProblem[] = [];
  for (const raw of records) {
    problems.push(...recordProblems(raw));
    const id = raw.id.trim();
    if (seen.has(id)) problems.push({ field: "id", code: "duplicateId", message: `expert-ai: duplicate id "${id}"` });
    seen.add(id);
  }
  return problems;
}

/**
 * Write a canonical record back as the settings document stores it. Absent optional
 * fields stay absent, so a round trip does not grow the document.
 */
export function storedRecord(record: CanonicalExpertRecord): ExpertRecord {
  return { ...record };
}
