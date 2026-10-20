import type { ExpertRecord } from "../types.js";

/** One `@` candidate: the expert id plus a one-line description. */
export interface MentionCandidate {
  name: string;
  description: string;
}

/**
 * Filter enabled experts for the `@` picker.
 * @returns Candidates whose id, name, description, or tags contain the query.
 */
export function mentionCandidates(
  records: readonly Pick<ExpertRecord, "id" | "name" | "description" | "tags">[],
  query: string,
): MentionCandidate[] {
  const needle = query.trim().toLowerCase();
  return records
    .filter((item) => `${item.id} ${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(needle))
    .map((item) => ({ name: item.id, description: `${item.name} · ${item.description}` }));
}
