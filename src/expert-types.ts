import type { ExpertCategory } from "./types.js";

export const MIMEOGRAPHS_REVISION = "a38f5fcad0853be3e98a6cd95d8e6bf8c66f7c7b";

export interface ExpertPackageBinding {
  source: "mimeographs";
  slug: string;
  /** Commit the files are stored and verified under; internal, never shown to the user. */
  revision: string;
  /** Branch or tag the user imported from; this is the version shown to the user. */
  ref: string;
}

/** Where an imported package is stored; the branch or tag it came from is not part of it. */
export type ExpertPackageLocation = Omit<ExpertPackageBinding, "ref">;

export interface ExpertCatalogEntry {
  slug: string;
  name: string;
  description: string;
  category: ExpertCategory;
  references: string[];
}

export interface ExpertPackageManifest extends ExpertPackageLocation {
  schemaVersion: 1;
  name: string;
  description: string;
  category: ExpertCategory;
  importedAt: string;
  sourceType: "public-method";
  reviewStatus: "unreviewed";
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

export interface ExpertReference {
  id: string;
  expertId: string;
  path: string;
  revision: string;
  sha256: string;
  sourceUrl: string;
  text: string;
  truncated: boolean;
}
