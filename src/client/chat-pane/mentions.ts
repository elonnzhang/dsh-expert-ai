import type { ExpertRecord } from "../../types.js";

/** Keep the id as the picker key while displaying and inserting the expert name. */
export interface MentionCandidate {
  name: string;
  label: string;
  description: string;
  value: string;
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
    .map((item) => ({
      name: item.id,
      label: item.name,
      description: item.description,
      value: `@${item.name} `,
    }));
}
