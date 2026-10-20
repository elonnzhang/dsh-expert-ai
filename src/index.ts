export {
  apply,
  Config,
  independentSystemPromptFor,
  independentSystemPromptPartsFor,
  inject,
  name,
  validateSettings,
} from "./host/index.js";
export { EXPERT_AI_CATEGORIES, EXPERT_AI_NAMESPACE } from "./constants.js";
export type * from "./types.js";
export type * from "./expert-types.js";
export { disclosureFor, ExpertIdentityProvider } from "./host/identity-service.js";
export type {
  ExpertIdentity,
  ExpertIdentityChange,
  ExpertIdentityOptions,
  ExpertIdentityService,
  ExpertIdentitySummary,
} from "./host/identity-service.js";
