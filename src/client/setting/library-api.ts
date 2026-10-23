import type { ExpertCatalogEntry } from "../../expert-types.js";

/** Host calls behind the expert library dialog. */
export interface ExpertLibraryApi {
  /**
   * List the experts on a branch or tag.
   * `cached` means GitHub was unreachable and the locally cached catalog for the ref was used.
   */
  catalog: (ref: string) => Promise<{ ref: string; cached: boolean; experts: ExpertCatalogEntry[] }>;
  /** Import one expert from a branch or tag; returns the record id. */
  importExpert: (slug: string, ref: string) => Promise<string>;
}
