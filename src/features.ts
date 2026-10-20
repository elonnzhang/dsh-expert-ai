import type { ExpertFeature } from "./types.js";

/** The features that are on for a configured list; `identity` is always on. */
export function enabledFeatures(configured: readonly ExpertFeature[] | undefined): ReadonlySet<ExpertFeature> {
  return new Set<ExpertFeature>(["identity", ...(configured ?? [])]);
}
