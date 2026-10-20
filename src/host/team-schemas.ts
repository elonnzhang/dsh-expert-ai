import { validateJsonSchemaValue, type ObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import type { BriefReport, CritiqueReport, SynthesisReport, TeamStageKind, TeamStageReport } from "../expert-types.js";
import { parseReviewReport, REVIEW_OUTPUT_SCHEMA } from "./review.js";

export const BRIEF_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: "object",
  properties: {
    objective: { type: "string" },
    acceptanceCriteria: { type: "array", items: { type: "string" } },
    constraints: { type: "array", items: { type: "string" } },
    clarifyingQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["objective", "acceptanceCriteria", "constraints", "clarifyingQuestions"],
  additionalProperties: false,
};

export const CRITIQUE_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          targetStageId: { type: "string" },
          issue: { type: "string" },
          kind: { type: "string", enum: ["counterexample", "unsupported", "risk", "missing"] },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["targetStageId", "issue", "kind", "evidenceIds"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "items"],
  additionalProperties: false,
};

export const SYNTHESIS_OUTPUT_SCHEMA: ObjectJsonSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: { type: "string" },
          kind: { type: "string", enum: ["observation", "inference", "proposal"] },
          evidenceIds: { type: "array", items: { type: "string" } },
        },
        required: ["claim", "kind", "evidenceIds"],
        additionalProperties: false,
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    nextActions: { type: "array", items: { type: "string" } },
    disagreements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: { type: "string" },
          positions: {
            type: "array",
            items: { type: "object", properties: { stageId: { type: "string" }, position: { type: "string" } }, required: ["stageId", "position"], additionalProperties: false },
          },
          type: { type: "string", enum: ["fact", "assumption", "applicability", "value"] },
          resolution: { type: "string", enum: ["gather-evidence", "experiment", "human-decision"] },
          test: { type: "string" },
        },
        required: ["topic", "positions", "type", "resolution"],
        additionalProperties: false,
      },
    },
    options: {
      type: "array",
      items: { type: "object", properties: { name: { type: "string" }, tradeoffs: { type: "string" } }, required: ["name", "tradeoffs"], additionalProperties: false },
    },
    validationPlan: {
      type: "array",
      items: {
        type: "object",
        properties: { task: { type: "string" }, decides: { type: "string" }, stopCondition: { type: "string" } },
        required: ["task", "decides", "stopCondition"],
        additionalProperties: false,
      },
    },
    missingStages: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "findings", "assumptions", "nextActions", "disagreements", "options", "validationPlan", "missingStages"],
  additionalProperties: false,
};

const text = (value: string, limit = 8_000): boolean => value.trim() !== "" && value.length <= limit;
const texts = (values: readonly string[], min = 0, max = 30): boolean =>
  values.length >= min && values.length <= max && values.every((value) => text(value));
function conform(schema: ObjectJsonSchema, value: unknown, label: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`expert-ai: ${label} output must be an object`);
  if (validateJsonSchemaValue(schema, value).length > 0 || JSON.stringify(value).length > 24_000)
    throw new Error(`expert-ai: ${label} output does not match the schema or exceeds the report limit`);
}
function cited(ids: readonly string[], evidenceIds: ReadonlySet<string>): void {
  if (ids.length > 20 || ids.some((id) => !evidenceIds.has(id)))
    throw new Error("expert-ai: citation to evidence not supplied to this stage");
}

/** Parse a coordinator brief: 1-8 acceptance criteria and 0-5 clarifying questions. */
export function parseBriefReport(value: unknown): BriefReport {
  conform(BRIEF_OUTPUT_SCHEMA, value, "brief");
  const report = value as BriefReport;
  if (!text(report.objective) || !texts(report.constraints)) throw new Error("expert-ai: invalid structured brief report");
  if (!texts(report.acceptanceCriteria, 1, 8)) throw new Error("expert-ai: brief needs 1-8 acceptance criteria");
  if (!texts(report.clarifyingQuestions, 0, 5)) throw new Error("expert-ai: brief allows 0-5 clarifying questions");
  return structuredClone(report);
}

/** Parse a cross-critique whose items may only target reports supplied to this stage. */
export function parseCritiqueReport(value: unknown, evidenceIds: ReadonlySet<string>, inputStageIds: ReadonlySet<string>): CritiqueReport {
  conform(CRITIQUE_OUTPUT_SCHEMA, value, "critique");
  const report = value as CritiqueReport;
  if (!text(report.summary) || report.items.length > 20 || report.items.some((item) => !text(item.issue)))
    throw new Error("expert-ai: invalid structured critique report");
  for (const item of report.items) {
    if (!inputStageIds.has(item.targetStageId)) throw new Error(`expert-ai: critique target ${item.targetStageId} was not supplied to this stage`);
    cited(item.evidenceIds, evidenceIds);
  }
  return structuredClone(report);
}

/** Parse a synthesis; `requiredMissing` lists failed or skipped required stages the report must name. */
export function parseSynthesisReport(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  inputStageIds: ReadonlySet<string>,
  requiredMissing: readonly string[],
): SynthesisReport {
  conform(SYNTHESIS_OUTPUT_SCHEMA, value, "synthesis");
  const report = value as SynthesisReport;
  const { disagreements, options, validationPlan, missingStages, ...base } = report;
  // Findings, assumptions and next actions share the analysis rules and citation checks.
  parseReviewReport({ ...base, disagreements: [] }, evidenceIds);
  if (disagreements.length > 20 || options.length > 10 || validationPlan.length > 20 || !texts(missingStages))
    throw new Error("expert-ai: invalid structured synthesis report");
  for (const item of disagreements) {
    if (!text(item.topic) || item.positions.length < 2) throw new Error("expert-ai: each disagreement needs a topic and at least 2 positions");
    if (item.positions.some((position) => !inputStageIds.has(position.stageId) || !text(position.position)))
      throw new Error("expert-ai: disagreement position cites a stage not supplied to synthesis");
    if (item.resolution === "experiment" && (item.test === undefined || !text(item.test)))
      throw new Error("expert-ai: experiment resolutions need a test");
  }
  if (options.some((item) => !text(item.name) || !text(item.tradeoffs)) || validationPlan.some((item) => !text(item.task) || !text(item.decides) || !text(item.stopCondition)))
    throw new Error("expert-ai: invalid structured synthesis report");
  const missing = requiredMissing.filter((id) => !missingStages.includes(id));
  if (missing.length > 0) throw new Error(`expert-ai: missingStages must list ${missing.join(", ")}`);
  return structuredClone(report);
}

/** Output schema passed to providers that support `outputSchema`. */
export function outputSchemaFor(kind: TeamStageKind): ObjectJsonSchema {
  return kind === "brief" ? BRIEF_OUTPUT_SCHEMA
    : kind === "cross-critique" ? CRITIQUE_OUTPUT_SCHEMA
      : kind === "synthesis" ? SYNTHESIS_OUTPUT_SCHEMA
        : REVIEW_OUTPUT_SCHEMA;
}

/** What a stage was given, used to check its citations. */
export interface StageVisibility { evidenceIds: ReadonlySet<string>; inputStageIds: ReadonlySet<string>; requiredMissing: readonly string[] }

/** Parse the raw output of one stage by its kind. */
export function parseStageReport(kind: TeamStageKind, value: unknown, visible: StageVisibility): TeamStageReport {
  switch (kind) {
    case "brief": return parseBriefReport(value);
    case "cross-critique": return parseCritiqueReport(value, visible.evidenceIds, visible.inputStageIds);
    case "synthesis": return parseSynthesisReport(value, visible.evidenceIds, visible.inputStageIds, visible.requiredMissing);
    default: return parseReviewReport(value, visible.evidenceIds);
  }
}
