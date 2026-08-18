import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { companies, triage } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

export const triageDecisions = ["interested", "skip", "block_company"] as const;
export type TriageDecision = (typeof triageDecisions)[number];

export function recordTriage(input: {
  jobId: number;
  profileId: number;
  decision: TriageDecision;
  reason?: string | null;
  companyId?: number;
  database?: JobHuntDatabase;
  now?: Date;
}): void {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  database.insert(triage).values({
    jobId: input.jobId,
    profileId: input.profileId,
    decision: input.decision,
    reason: input.reason?.trim() || null,
    decidedAt: now,
  }).run();
  if (input.decision === "block_company" && input.companyId) {
    database.update(companies).set({ blocked: true }).where(eq(companies.id, input.companyId)).run();
  }
}

export function listRecentTriage(
  profileId: number,
  database: JobHuntDatabase = db,
) {
  return database.select().from(triage).where(eq(triage.profileId, profileId)).orderBy(desc(triage.decidedAt)).limit(50).all();
}
