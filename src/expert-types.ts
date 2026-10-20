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

/** A saved review lineup: 1–3 analysts critiqued and synthesized by one reviewer. */
export interface ExpertTeam {
  id: string;
  name: string;
  /** What this lineup is meant to review; shown to the user only. */
  purpose: string;
  /** 1–3 unique record ids. */
  analystIds: string[];
  /** Record id; never one of the analysts. */
  reviewerId: string;
  /** Record id leading the brief stage; the reviewer when omitted. May also hold another role. */
  coordinatorId?: string;
  /** Member id → responsibility (1–200 characters); members without one do 综合分析. */
  responsibilities?: Record<string, string>;
  /** Identity of the team's own session host (1–8000 characters); a neutral default when omitted. */
  persona?: string;
}

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

export interface ReviewRequest {
  question: string;
  expertIds: string[];
  reviewerId: string;
}

export interface ReviewReport {
  summary: string;
  findings: Array<{
    claim: string;
    kind: "observation" | "inference" | "proposal";
    evidenceIds: string[];
  }>;
  assumptions: string[];
  disagreements: string[];
  nextActions: string[];
}

export type ReviewRole = "analyst" | "critic" | "synthesizer";
export type ReviewStatus = "running" | "completed" | "partial" | "failed" | "cancelled" | "timed-out";

export interface ReviewStep {
  id: string;
  role: ReviewRole;
  expertId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  report?: ReviewReport;
  error?: string;
}

export interface ReviewRun {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: ReviewStatus;
  request: ReviewRequest;
  experts: Array<{
    id: string;
    name: string;
    identity: string;
    identitySha256: string;
    model?: { provider?: string; model?: string };
    expertPackage?: ExpertPackageBinding;
  }>;
  evidence: ExpertReference[];
  steps: ReviewStep[];
  error?: string;
}

export type ReviewSummary = Pick<ReviewRun, "id" | "createdAt" | "updatedAt"> & {
  /** Session that owns the review, so the UI can reopen its conversation. */
  sessionId: string;
  status: ReviewStatus | TeamRunStatus;
  question: string;
  schemaVersion: 1 | 2;
};

export type TeamStageKind = "brief" | "analysis" | "cross-critique" | "review" | "synthesis";
export type TeamRunStatus = "open" | "running" | "completed" | "partial" | "failed" | "cancelled" | "timed-out" | "expired";
export type TeamMemberRole = "coordinator" | "analyst" | "reviewer";
export interface BriefReport { objective: string; acceptanceCriteria: string[]; constraints: string[]; clarifyingQuestions: string[] }
export interface CritiqueReport {
  summary: string;
  items: Array<{ targetStageId: string; issue: string; kind: "counterexample" | "unsupported" | "risk" | "missing"; evidenceIds: string[] }>;
}
export type DisagreementType = "fact" | "assumption" | "applicability" | "value";
export type DisagreementResolution = "gather-evidence" | "experiment" | "human-decision";
export interface SynthesisReport extends Omit<ReviewReport, "disagreements"> {
  disagreements: Array<{ topic: string; positions: Array<{ stageId: string; position: string }>; type: DisagreementType; resolution: DisagreementResolution; test?: string }>;
  options: Array<{ name: string; tradeoffs: string }>;
  validationPlan: Array<{ task: string; decides: string; stopCondition: string }>;
  missingStages: string[];
}
export type TeamStageReport = BriefReport | ReviewReport | CritiqueReport | SynthesisReport;
export interface TeamMember {
  id: string; name: string; roles: TeamMemberRole[]; responsibility: string;
  identity: string; identitySha256: string;
  model?: { provider?: string; model?: string };
  expertPackage?: ExpertPackageBinding;
}
export interface TeamStage {
  id: string; kind: TeamStageKind; expertId: string; briefVersion: number;
  inputStageIds: string[]; evidenceIds: string[];
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string; finishedAt?: string; report?: TeamStageReport; error?: string;
}
export interface TeamRun {
  schemaVersion: 2; id: string; sessionId: string; teamId?: string;
  createdAt: string; updatedAt: string; status: TeamRunStatus;
  briefs: Array<{ version: number; text: string; source: "user" | "amendment"; createdAt: string }>;
  members: TeamMember[]; evidence: ExpertReference[]; stages: TeamStage[];
  budget: { maxCalls: number; callsUsed: number; maxActiveMs: number; activeMs: number };
  error?: string;
}
export type AnyReviewRun = ReviewRun | TeamRun;
