/** The plugin's settings Schema and the checks a settings write must pass before it commits. */
import type { Volatile } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { EXPERT_AI_CATEGORIES, EXPERT_AVATAR_MIMES, EXPERT_SOURCE_KINDS } from "../constants.js";
import { normalizeRecord, settingsProblems } from "../record-model.js";
import type { CanonicalExpertRecord, ExpertRecord, ExpertSettings, ResolvedExpertSettings } from "../types.js";

const PackageBinding = {
  source: z.const("mimeographs"),
  slug: z.string(),
  revision: z.string(),
  // Packages imported before the branch or tag was recorded only carry their commit.
  ref: z.string().required(false),
};

// z.object() defaults to `{}`, which would turn an absent value into an invalid one;
// the union with undefined keeps an absent field absent.
const Origin = z.union([
  // 新建
  z.object({ kind: z.const("managed").required() }),
  // 文件导入
  z.object({ kind: z.const("file").required(), path: z.string().required() }),
  // 内置   ./experts
  z.object({ kind: z.const("bundled").required(), path: z.string().required() }),
  // 导入包 | mimeographs |
  z.object({ kind: z.const("package").required(), ...PackageBinding }),
  z.const(undefined),
]);

const RecordSchema: z<ExpertRecord> = z.object({
  id: z.string(),
  name: z.string(),
  title: z.string().required(false),
  description: z.string().default(""),
  category: z.union([...EXPERT_AI_CATEGORIES]),
  customCategory: z.string().required(false),
  tags: z.array(z.string()).default([]),
  persona: z.string().default(""),
  origin: Origin.required(false),
  toolFilter: z.array(z.string()).required(false),
  model: z
    .object({
      provider: z.string().required(false),
      model: z.string().required(false),
    })
    .required(false),
  avatar: z.union([
    z.object({ mime: z.union([...EXPERT_AVATAR_MIMES]), data: z.string() }),
    z.const(undefined),
  ]).required(false),
  source: z.union([
    z.object({ kind: z.union([...EXPERT_SOURCE_KINDS]), note: z.string().required(false) }),
    z.const(undefined),
  ]).required(false),
  enabled: z.boolean().default(true),
  // Read only to migrate records saved before `origin`; never written.
  tag: z.string().required(false),
  agent: z.string().required(false),
  expertPackage: z.union([z.object(PackageBinding), z.const(undefined)]).required(false),
}) as unknown as z<ExpertRecord>;

/**
 * Live plugin config. Every editable field is `.volatile()` so a settings write applies
 * to the running fiber in place (no reload). Read a field with `config.<field>.get()`.
 */
export interface Config {
  stateDir: Volatile<string | undefined>;
  records: Volatile<ExpertRecord[]>;
}

export const Config: z<ExpertSettings, Config> = z.object({
  stateDir: z.string().required(false).volatile(),
  records: z.array(RecordSchema).default([]).volatile(),
});

/** Throw the first reason the settings cannot be stored. */
export function validateSettings(settings: ExpertSettings): void {
  const [problem] = settingsProblems(settings.records ?? []);
  if (problem !== undefined) throw new Error(problem.message);
}

export function resolved(settings: ExpertSettings): ResolvedExpertSettings {
  return { records: (settings.records ?? []).map(normalizeRecord) };
}

/** The enabled record with this id; unknown and disabled ids fail with a message the user can act on. */
export function findRecord(settings: ResolvedExpertSettings, id: string): CanonicalExpertRecord {
  const record = settings.records.find((item) => item.id === id);
  if (record === undefined) throw new Error(`expert-ai: unknown expert "${id}"`);
  if (!record.enabled) throw new Error(`expert-ai: expert "${id}" is disabled`);
  return record;
}
