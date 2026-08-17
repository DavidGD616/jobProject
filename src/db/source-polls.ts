import { and, eq } from "drizzle-orm";

import { companies, sourcePolls } from "./schema";
import type { Company, SourcePoll } from "./schema";
import type { JobHuntDatabase } from "./types";

export interface DueSourcePoll {
  company: Company;
  poll: SourcePoll | null;
}

/**
 * Source work is deliberately selected by the persisted due timestamp rather
 * than a process-local interval. Restarting a worker therefore cannot create
 * a burst of repeat requests.
 */
export function listDueSourcePolls(
  db: JobHuntDatabase,
  input: { source: string; now: Date; force?: boolean },
): DueSourcePoll[] {
  const rows = db
    .select({ company: companies, poll: sourcePolls })
    .from(companies)
    .leftJoin(
      sourcePolls,
      and(
        eq(sourcePolls.companyId, companies.id),
        eq(sourcePolls.source, input.source),
      ),
    )
    .where(
      and(
        eq(companies.atsType, input.source),
        eq(companies.active, true),
        eq(companies.blocked, false),
      ),
    )
    .all();

  if (input.force) return rows;
  return rows.filter(
    ({ poll }) => poll?.nextPollAt === null || poll?.nextPollAt === undefined ||
      poll.nextPollAt <= input.now,
  );
}

export function recordSourcePollSuccess(
  db: JobHuntDatabase,
  input: {
    companyId: number;
    source: string;
    etag: string | null;
    status: "fetched" | "not_modified";
    fetchedAt: Date;
    nextPollAt: Date;
  },
): void {
  const values = {
    companyId: input.companyId,
    source: input.source,
    etag: input.etag,
    lastFetchedAt: input.fetchedAt,
    lastSuccessfulAt: input.fetchedAt,
    nextPollAt: input.nextPollAt,
    consecutiveFailures: 0,
    lastStatus: input.status,
    lastError: null,
    updatedAt: input.fetchedAt,
  };
  db
    .insert(sourcePolls)
    .values(values)
    .onConflictDoUpdate({
      target: [sourcePolls.companyId, sourcePolls.source],
      set: values,
    })
    .run();
}

export function recordSourcePollFailure(
  db: JobHuntDatabase,
  input: {
    companyId: number;
    source: string;
    status: string;
    error: string;
    consecutiveFailures: number;
    fetchedAt: Date;
    nextPollAt: Date | null;
  },
): void {
  const values = {
    companyId: input.companyId,
    source: input.source,
    lastFetchedAt: input.fetchedAt,
    nextPollAt: input.nextPollAt,
    consecutiveFailures: input.consecutiveFailures,
    lastStatus: input.status,
    lastError: input.error,
    updatedAt: input.fetchedAt,
  };
  db
    .insert(sourcePolls)
    .values(values)
    .onConflictDoUpdate({
      target: [sourcePolls.companyId, sourcePolls.source],
      set: values,
    })
    .run();
}

/** A definitively missing public board is inactive, but never deleted. */
export function deactivateCompanyBoard(
  db: JobHuntDatabase,
  input: { companyId: number; checkedAt: Date },
): void {
  db
    .update(companies)
    .set({ active: false, lastProbeAt: input.checkedAt })
    .where(eq(companies.id, input.companyId))
    .run();
}
