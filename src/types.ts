import {
  EXPERT_AI_CATEGORIES,
  EXPERT_AVATAR_MIMES,
  EXPERT_ORIGIN_KINDS,
  EXPERT_SOURCE_KINDS,
} from "./constants.js";
import type { ExpertPackageBinding } from "./expert-types.js";

export type ExpertCategory = (typeof EXPERT_AI_CATEGORIES)[number];

export type ExpertIdentitySourceKind = (typeof EXPERT_SOURCE_KINDS)[number];

export type ExpertIdentityAvatarMime = (typeof EXPERT_AVATAR_MIMES)[number];

export type ExpertOriginKind = (typeof EXPERT_ORIGIN_KINDS)[number];

/**
 * Where an identity's body is stored. Every record resolves to exactly one origin;
 * metadata (name, title, tags, ...) always comes from the record itself.
 */
export type ExpertOrigin =
  /** `$DSH_HOME/expert-ai/<id>/agents/<id>.md`, written by the settings page. */
  | { kind: "managed" }
  /** A Markdown file on the Host; it is the only source and is never written. */
  | { kind: "file"; path: string }
  /** A pack directory inside the plugin package, such as `experts/ELON`, `experts/xingtu/clq` or a deeper subfolder. */
  | { kind: "bundled"; path: string }
  /** An imported pack under `<source>/<slug>/`; its manifest pins the commit. */
  | ({ kind: "package" } & ExpertPackageBinding);

/** Where the persona's material comes from. */
export interface ExpertIdentitySource {
  kind: ExpertIdentitySourceKind;
  /** Free text for people (for example the material used); never added to the disclosure. */
  note?: string;
}

/** Avatar image; `data` is base64 without the `data:` prefix. */
export interface ExpertIdentityAvatar {
  mime: ExpertIdentityAvatarMime;
  data: string;
}

export interface ExpertRecord {
  id: string;
  name: string;
  /** Text shown after the name, for example "储能系统思考助手". Defaults to "Bot". */
  title?: string;
  description: string;
  /** Stable primary domain used for coarse grouping and search. */
  category: ExpertCategory;
  /** User-defined domain label when category is custom. */
  customCategory?: string;
  /** Composable characteristics used for search. */
  tags: string[];
  /** @deprecated Legacy single tag, accepted only for settings migration. */
  tag?: string;
  /** Editor text of a managed identity, persisted to `<id>/agents/<id>.md`; empty for other origins. */
  persona: string;
  /** Where the identity body is stored. Records saved before this field existed are migrated on read. */
  origin?: ExpertOrigin | undefined;
  /** @deprecated Pre-`origin` identity path, read only for migration. */
  agent?: string;
  /** Tools a consultation may use; absent inherits every tool the provider offers. */
  toolFilter?: string[];
  /** Provider and model a consultation runs on; absent follows the provider default. */
  model?: { provider?: string; model?: string };
  /** @deprecated Pre-`origin` package binding, read only for migration. */
  expertPackage?: ExpertPackageBinding | undefined;
  /** Picture shown with the identity. */
  avatar?: ExpertIdentityAvatar | undefined;
  /** What the persona was built from. Absent means public material. */
  source?: ExpertIdentitySource | undefined;
  enabled: boolean;
}

export interface ExpertSettings {
  /** Optional plugin state directory or its parent. Defaults to `$DSH_HOME/expert-ai` (`~/.dsh/expert-ai`). */
  stateDir?: string;
  records?: ExpertRecord[];
}

export interface ResolvedExpertSettings {
  records: CanonicalExpertRecord[];
}

/**
 * A record after migration and normalization: `origin` is set, the legacy fields
 * (`agent`, `expertPackage`, `tag`) are gone, and text fields are trimmed.
 */
export type CanonicalExpertRecord = Omit<ExpertRecord, "origin" | "agent" | "expertPackage" | "tag"> & {
  origin: ExpertOrigin;
};
