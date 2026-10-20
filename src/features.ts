import type { DigitalLifeFeature } from "./types.js";

/** The features that are on for a configured list; `identity` is always on. */
export function enabledFeatures(configured: readonly DigitalLifeFeature[] | undefined): ReadonlySet<DigitalLifeFeature> {
  return new Set<DigitalLifeFeature>(["identity", ...(configured ?? [])]);
}
