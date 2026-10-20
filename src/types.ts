import {
  DIGITAL_LIFE_CATEGORIES,
  DIGITAL_LIFE_FEATURES,
  EXPERT_AVATAR_MIMES,
  EXPERT_SOURCE_KINDS,
} from "./constants.js";
import type { ExpertPackageBinding, ExpertTeam } from "./expert-types.js";

export type DigitalLifeCategory = (typeof DIGITAL_LIFE_CATEGORIES)[number];

export type DigitalLifeFeature = (typeof DIGITAL_LIFE_FEATURES)[number];

export type ExpertIdentitySourceKind = (typeof EXPERT_SOURCE_KINDS)[number];

export type ExpertIdentityAvatarMime = (typeof EXPERT_AVATAR_MIMES)[number];

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

export interface DigitalLifeRecord {
  id: string;
  name: string;
  /** Text shown after the name, for example "储能系统思考助手". Defaults to "思考助手". */
  title?: string;
  description: string;
  /** Stable primary domain used for coarse grouping and routing. */
  category: DigitalLifeCategory;
  /** User-defined domain label when category is custom. */
  customCategory?: string;
  /** Composable characteristics used for search and future team routing. */
  tags: string[];
  /** @deprecated Legacy single tag, accepted only for settings migration. */
  tag?: string;
  /** Legacy/editor identity text, persisted to the record's agents/<id>.md. */
  persona: string;
  /** Optional ~/.agent/agents or ~/.claude/agents Markdown identity source. */
  agent?: string;
  toolFilter?: string[];
  model?: { provider?: string; model?: string };
  /** Immutable upstream package; user configuration remains separate. */
  expertPackage?: ExpertPackageBinding | undefined;
  /** Picture shown with the identity. */
  avatar?: ExpertIdentityAvatar | undefined;
  /** What the persona was built from. Absent means public material. */
  source?: ExpertIdentitySource | undefined;
  enabled: boolean;
}

export interface DigitalLifeSettings {
  /** Parts of the plugin that are on. Defaults to `["identity"]`; `identity` is on even when omitted. */
  features?: DigitalLifeFeature[];
  provider?: string;
  maxBatchSize?: number;
  /** Optional plugin state directory. Defaults to ~/.dsh/digital-life. */
  stateDir?: string;
  records?: DigitalLifeRecord[];
  /** Saved review lineups referencing record ids. */
  teams?: ExpertTeam[];
}

export interface ResolvedDigitalLifeSettings {
  provider: string;
  maxBatchSize: number;
  records: DigitalLifeRecord[];
  teams: ExpertTeam[];
}
