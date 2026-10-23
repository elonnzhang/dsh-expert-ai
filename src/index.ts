export { apply, Config, inject, name, validateSettings } from "./host/index.js";
export { EXPERT_AI_CATEGORIES, EXPERT_AI_NAMESPACE, EXPERT_ORIGIN_KINDS } from "./constants.js";
export { normalizeRecord, originOf, recordProblems, settingsProblems } from "./record-model.js";
export type { RecordProblem, RecordProblemCode, RecordField } from "./record-model.js";
export type * from "./types.js";
export type * from "./expert-types.js";
export { disclosureFor, ExpertIdentityProvider } from "./host/identity/index.js";
export type {
  ExpertIdentity,
  ExpertIdentityChange,
  ExpertIdentityOptions,
  ExpertIdentityService,
  ExpertIdentitySummary,
} from "./host/identity/index.js";
export {
  chatPromptParts,
  compileChatPlan,
  compileConsultationPlan,
  type ConsultationPlan,
  type ExpertPlan,
  type ExpertPolicy,
} from "./host/runtime/index.js";
