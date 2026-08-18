import { eq } from "drizzle-orm";

import { db } from "@/db";
import { applicationRuns, applications, jobs, resumeVariants } from "@/db/schema";
import type { Profile } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

import { adapterForUrl } from "./adapters";
import type { ApplyPlan } from "./types";

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
  const run = database.insert(applicationRuns).values({
    applicationId: input.applicationId,
    adapter: adapter.id,
    status: "ready_for_review",
    fields: plan as unknown as Record<string, unknown>,
    startedAt: now,
    finishedAt: now,
    error: null,
  }).returning().get()!;
  return { run, plan };
}

export function listApplicationRuns(applicationId: number, database: JobHuntDatabase = db) {
  return database.select().from(applicationRuns).where(eq(applicationRuns.applicationId, applicationId)).all();
}
