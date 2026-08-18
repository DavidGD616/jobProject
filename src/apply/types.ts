import type { Application, Job, Profile, ResumeVariant } from "@/db/schema";

export type ApplyAdapterId = "greenhouse" | "lever" | "generic";

export interface ApplyFieldPlan {
  key: string;
  label: string;
  value: string | null;
  selector: string | null;
  required: boolean;
  source: "profile" | "resume_variant" | "job" | "human";
}

export interface ApplyPlan {
  adapter: ApplyAdapterId;
  url: string;
  fields: ApplyFieldPlan[];
  customQuestions: string[];
  submissionBlocked: true;
  instructions: string[];
}

/**
 * Immutable material provenance captured when a local application review plan
 * is prepared. This is stored inside `application_runs.fields` so existing
 * application-run history stays append-only.
 */
export interface ApplicationMaterialSnapshot {
  resumeVariantId: number | null;
  profileVersion: number | null;
  jobContentHash: string | null;
  promptVersion: string | null;
  coverLetterHash: string;
}

/** The persisted plan adds material provenance without changing the ATS plan shape. */
export interface PersistedApplyPlan extends ApplyPlan {
  materialSnapshot: ApplicationMaterialSnapshot;
}

export interface ApplyContext {
  application: Application;
  job: Job;
  profile: Profile;
  resumeVariant: ResumeVariant | null;
}

export interface ApplyAdapter {
  id: ApplyAdapterId;
  matches(url: string): boolean;
  buildPlan(context: ApplyContext): ApplyPlan;
}
