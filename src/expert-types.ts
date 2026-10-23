import type { ExpertCategory, ExpertIdentitySource } from "./types.js";

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

/** One catalog entry at a resolved mimeographs commit. */
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
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

/** The metadata and integrity list shipped by a bundled or imported v2 expert pack. */
export interface ExpertPackManifestV2 {
  schemaVersion: 2;
  origin: "bundled" | "package";
  id: string;
  name: string;
  title?: string;
  description: string;
  category: ExpertCategory;
  tags: string[];
  source: ExpertIdentitySource;
  provenance: {
    collection: string;
    slug?: string;
    revision?: string;
    importedAt?: string;
  };
  files: Array<{ path: string; sha256: string; bytes: number }>;
}

/** One verified reference file from a bundled or imported expert pack. */
export interface ExpertReference {
  id: string;
  expertId: string;
  path: string;
  revision: string;
  sha256: string;
  sourceUrl?: string;
  text: string;
  truncated: boolean;
}
