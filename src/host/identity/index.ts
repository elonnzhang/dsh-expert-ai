export { agentPath, createProject, expertAiHome, packageRootFrom } from "./paths.js";
export { agentDocument, agentIdentity } from "./markdown.js";
export {
  listPackReferences,
  loadPackManifest,
  packLocation,
  readPackFile,
  readPackIdentity,
  readPackReference,
} from "./packs.js";
export type { PackLocation } from "./packs.js";
export {
  importMimeograph,
  loadExpertCatalog,
  recordForPackage,
  resolveRevision,
} from "./mimeographs.js";
export { identityFor, initializeIdentities, reconcileIdentities } from "./store.js";
export { disclosureFor, ExpertIdentityProvider } from "./service.js";
export type * from "./service.js";
export type { ExpertPackManifestV2 } from "../../expert-types.js";
