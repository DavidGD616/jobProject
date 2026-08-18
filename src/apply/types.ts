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
