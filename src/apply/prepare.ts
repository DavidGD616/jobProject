import { createHash } from "node:crypto";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { applicationRuns, applications, jobs, resumeVariants } from "@/db/schema";
import type { Application, ApplicationRun, Job, Profile, ResumeVariant } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

import { adapterForUrl } from "./adapters";
import type { ApplicationMaterialSnapshot, ApplyPlan, PersistedApplyPlan } from "./types";

/** A stable fingerprint lets us detect a reviewed letter changing after preparation. */
export function coverLetterContentHash(coverLetter: string | null | undefined): string {
  return createHash("sha256").update(coverLetter ?? "").digest("hex");
}

/**
 * Capture the exact locally attached material metadata without modifying old
 * application runs. A null provenance field is intentional for legacy
 * variants, and makes that run stale when checked later.
 */
export function createApplicationMaterialSnapshot(input: {
  application: Application;
  resumeVariant: ResumeVariant | null;
}): ApplicationMaterialSnapshot {
  const variant = input.resumeVariant;
  return {
    resumeVariantId: input.application.resumeVariantId,
    profileVersion: variant?.profileVersion ?? null,
    jobContentHash: variant?.jobContentHash ?? null,
    promptVersion: variant?.promptVersion ?? null,
    coverLetterHash: coverLetterContentHash(variant?.coverLetter ?? input.application.coverLetter),
  };
}

function readMaterialSnapshot(fields: Record<string, unknown>): ApplicationMaterialSnapshot | null {
  const candidate = fields.materialSnapshot;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const snapshot = candidate as Record<string, unknown>;
  const isNullableInteger = (value: unknown): value is number | null => value === null || (typeof value === "number" && Number.isInteger(value));
  const isNullableString = (value: unknown): value is string | null => value === null || typeof value === "string";
  const resumeVariantId = snapshot.resumeVariantId;
  const profileVersion = snapshot.profileVersion;
  const jobContentHash = snapshot.jobContentHash;
  const promptVersion = snapshot.promptVersion;
  const coverLetterHash = snapshot.coverLetterHash;
  if (
    !isNullableInteger(resumeVariantId)
    || !isNullableInteger(profileVersion)
    || !isNullableString(jobContentHash)
    || !isNullableString(promptVersion)
    || typeof coverLetterHash !== "string"
  ) return null;
  return {
    resumeVariantId,
    profileVersion,
    jobContentHash,
    promptVersion,
    coverLetterHash,
  };
}

/**
 * A prepared browser run must be reviewed again if its attached materials no
 * longer represent the active resume, job, profile, or cover letter.
 * Historical runs without an immutable snapshot are deliberately stale.
 */
export function isApplicationRunStale(
  run: ApplicationRun,
  currentVariant: ResumeVariant | null,
  currentJob: Job,
  currentProfile: Profile,
): boolean {
  const snapshot = readMaterialSnapshot(run.fields);
  if (!snapshot || !currentVariant) return true;
  if (
    snapshot.resumeVariantId === null
    || snapshot.profileVersion === null
    || snapshot.jobContentHash === null
    || snapshot.promptVersion === null
  ) return true;
  return (
    snapshot.resumeVariantId !== currentVariant.id
    || currentVariant.jobId !== currentJob.id
    || snapshot.profileVersion !== currentVariant.profileVersion
    || snapshot.profileVersion !== currentProfile.version
    || snapshot.jobContentHash !== currentVariant.jobContentHash
    || snapshot.jobContentHash !== currentJob.contentHash
    || snapshot.promptVersion !== currentVariant.promptVersion
    || snapshot.coverLetterHash !== coverLetterContentHash(currentVariant.coverLetter)
  );
}

export async function prepareApplication(input: {
  applicationId: number;
  profile: Profile;
  database?: JobHuntDatabase;
  now?: Date;
}): Promise<{ run: typeof applicationRuns.$inferSelect; plan: ApplyPlan }> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const row = database.select({ application: applications, job: jobs, resumeVariant: resumeVariants })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .leftJoin(resumeVariants, eq(applications.resumeVariantId, resumeVariants.id))
    .where(eq(applications.id, input.applicationId))
    .get();
  if (!row) throw new Error(`Application ${input.applicationId} not found`);
  const adapter = adapterForUrl(row.job.url);
  const plan = adapter.buildPlan({ application: row.application, job: row.job, profile: input.profile, resumeVariant: row.resumeVariant });
  const persistedPlan: PersistedApplyPlan = {
    ...plan,
    materialSnapshot: createApplicationMaterialSnapshot({
      application: row.application,
      resumeVariant: row.resumeVariant,
    }),
  };
  const run = database.insert(applicationRuns).values({
    applicationId: input.applicationId,
    adapter: adapter.id,
    status: "ready_for_review",
    fields: persistedPlan as unknown as Record<string, unknown>,
    startedAt: now,
    finishedAt: now,
    error: null,
  }).returning().get()!;
  return { run, plan };
}

export function listApplicationRuns(applicationId: number, database: JobHuntDatabase = db) {
  return database
    .select()
    .from(applicationRuns)
    .where(eq(applicationRuns.applicationId, applicationId))
    .orderBy(asc(applicationRuns.startedAt), asc(applicationRuns.id))
    .all();
}
