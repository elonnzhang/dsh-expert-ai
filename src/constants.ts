export const EXPERT_AI_NAMESPACE = "expert-ai";

/** The Host serves each endpoint on this shared channel as `expert-ai/<endpoint>`. */
export const EXPERT_AI_RPC_CHANNEL = "/api";

export const expertAiEndpoint = (endpoint: string): string => `${EXPERT_AI_NAMESPACE}/${endpoint}`;

/** Switchable parts; `identity` is always on, `conversation` adds the single-expert consult tools, persona binding, Chat Panel and `@` source. */
export const EXPERT_AI_FEATURES = ["identity", "conversation"] as const;

export const EXPERT_AI_CATEGORIES = ["business", "science", "culture", "tech", "entertainment", "custom"] as const;

/** Display name of each primary domain; a `custom` record carries its own label. */
export const EXPERT_AI_CATEGORY_LABELS = {
  business: "企业",
  science: "科学",
  tech: "技术",
  culture: "文化",
  entertainment: "娱乐",
} as const satisfies Record<Exclude<(typeof EXPERT_AI_CATEGORIES)[number], "custom">, string>;

/** What an identity's persona was built from; it decides the disclosure the Bot must give. */
export const EXPERT_SOURCE_KINDS = ["public", "organization", "authorized"] as const;

/** Image types an identity avatar may use. */
export const EXPERT_AVATAR_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

/** Longest `data:` URL of an avatar. The Bot runtime rejects anything longer. */
export const MAX_EXPERT_AVATAR_LENGTH = 160_000;

/** Title shown after the name when a record sets none. */
export const DEFAULT_EXPERT_TITLE = "思考助手";

export const MAX_EXPERT_TITLE_LENGTH = 40;

export const MAX_EXPERT_SOURCE_NOTE_LENGTH = 200;
