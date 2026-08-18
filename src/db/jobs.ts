import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";

import { contentHash } from "@/ingest/hash";
import { applyIngestHeuristics, stripBoilerplate } from "@/ingest/heuristics";
import type { NormalizedPosting } from "@/sources";

import { jobs } from "./schema";
import type { Company } from "./schema";
import type { JobHuntDatabase } from "./types";

export interface ObservedPosting {
  sourceId: string;
  posting: NormalizedPosting;
}

export interface JobIngestSummary {
  inserted: number;
  updated: number;
  canonicalized: number;
  firstMissing: number;
  closed: number;
}

function emptySummary(): JobIngestSummary {
  return { inserted: 0, updated: 0, canonicalized: 0, firstMissing: 0, closed: 0 };
}

function mergeSummary(
  target: JobIngestSummary,
  source: Partial<JobIngestSummary>,
): void {
  target.inserted += source.inserted ?? 0;
  target.updated += source.updated ?? 0;
  target.canonicalized += source.canonicalized ?? 0;
  target.firstMissing += source.firstMissing ?? 0;
  target.closed += source.closed ?? 0;
}

function reconcileHashGroup(
  db: JobHuntDatabase,
  companyId: number,
  hash: string,
): number {
  const members = db
    .select({ id: jobs.id, closedAt: jobs.closedAt })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), eq(jobs.contentHash, hash)))
    // An open duplicate is a more useful canonical job than an older closed
    // one; null closedAt values sort first in SQLite's ascending order.
    .orderBy(asc(jobs.closedAt), jobs.firstSeenAt, jobs.id)
    .all();
  const canonical = members[0];
  if (!canonical) return 0;

  const duplicateIds = members.slice(1).map((member) => member.id);
  db
    .update(jobs)
    .set({ canonicalId: null })
    .where(eq(jobs.id, canonical.id))
    .run();
  if (duplicateIds.length > 0) {
    db
      .update(jobs)
      .set({ canonicalId: canonical.id })
      .where(inArray(jobs.id, duplicateIds))
      .run();
  }
  return duplicateIds.length;
}

/**
 * Insert or refresh one source's observed postings and keep exact/content-hash
 * deduplication reversible through jobs.canonicalId.
 */
function writeObservedPostings(
  db: JobHuntDatabase,
  input: {
    company: Company;
    source: string;
    postings: readonly ObservedPosting[];
    observedAt: Date;
  },
): JobIngestSummary {
  const summary = emptySummary();

  const touchedHashes = new Set<string>();

  for (const observed of input.postings) {
    const normalized = applyIngestHeuristics(observed.posting);
    const nextHash = contentHash({
      titleNorm: normalized.titleNorm,
      companySlug: input.company.slug,
      description: normalized.description,
    });
    const existing = db
      .select({ id: jobs.id, contentHash: jobs.contentHash })
      .from(jobs)
      .where(
        and(
          eq(jobs.source, input.source),
          eq(jobs.sourceId, observed.sourceId),
        ),
      )
      .limit(1)
      .all();

    const values = {
      companyId: input.company.id,
      source: input.source,
      sourceId: observed.sourceId,
      url: normalized.url,
      title: normalized.title,
      titleNorm: normalized.titleNorm,
      description: normalized.description,
      descriptionFts: stripBoilerplate(normalized.description),
      location: normalized.location ?? null,
      remoteType: normalized.remoteType ?? null,
      salaryMin: normalized.salaryMin ?? null,
      salaryMax: normalized.salaryMax ?? null,
      salaryPeriod: normalized.salaryPeriod ?? null,
      currency: normalized.currency ?? null,
      seniority: normalized.seniority ?? null,
      stack: normalized.stack ?? null,
      extractionTier: normalized.extractionTier,
      postedAt: normalized.postedAt ?? null,
      lastSeenAt: input.observedAt,
      missingSinceAt: null,
      closedAt: null,
      contentHash: nextHash,
    };

    if (existing[0]) {
      db.update(jobs).set(values).where(eq(jobs.id, existing[0].id)).run();
      summary.updated += 1;
      touchedHashes.add(existing[0].contentHash);
    } else {
      db.insert(jobs).values({
        ...values,
        firstSeenAt: input.observedAt,
      }).run();
      summary.inserted += 1;
    }
    touchedHashes.add(nextHash);
  }

  for (const hash of touchedHashes) {
    mergeSummary(summary, {
      canonicalized: reconcileHashGroup(db, input.company.id, hash),
    });
  }

  return summary;
}

/**
 * A fetched board is authoritative for its own source. The first successful
 * omission records missingSinceAt; the second consecutive omission closes the
 * row. Conditional 304 responses never call this function.
 */
function markMissingSourceJobsInTransaction(
  db: JobHuntDatabase,
  input: { companyId: number; source: string; observedAt: Date },
): Pick<JobIngestSummary, "canonicalized" | "firstMissing" | "closed"> {
  const absent = db
    .select({
      id: jobs.id,
      missingSinceAt: jobs.missingSinceAt,
      contentHash: jobs.contentHash,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.companyId, input.companyId),
        eq(jobs.source, input.source),
        isNull(jobs.closedAt),
        lt(jobs.lastSeenAt, input.observedAt),
      ),
    )
    .all();

  const firstMissingIds = absent
    .filter((job) => job.missingSinceAt === null)
    .map((job) => job.id);
  const closingJobs = absent.filter((job) => job.missingSinceAt !== null);
  const closingIds = closingJobs.map((job) => job.id);

  if (firstMissingIds.length > 0) {
    db
      .update(jobs)
      .set({ missingSinceAt: input.observedAt })
      .where(inArray(jobs.id, firstMissingIds))
      .run();
  }
  if (closingIds.length > 0) {
    db
      .update(jobs)
      .set({ closedAt: input.observedAt })
      .where(inArray(jobs.id, closingIds))
      .run();
  }

  let canonicalized = 0;
  for (const hash of new Set(closingJobs.map((job) => job.contentHash))) {
    canonicalized += reconcileHashGroup(db, input.companyId, hash);
  }

  return {
    canonicalized,
    firstMissing: firstMissingIds.length,
    closed: closingIds.length,
  };
}

/** Insert/refresh an observation set without evaluating absence state. */
export async function ingestObservedPostings(
  db: JobHuntDatabase,
  input: {
    company: Company;
    source: string;
    postings: readonly ObservedPosting[];
    observedAt: Date;
  },
): Promise<JobIngestSummary> {
  return db.transaction((tx) => writeObservedPostings(tx, input));
}

/** Record one successful source snapshot atomically with its staleness sweep. */
export async function ingestSourceSnapshot(
  db: JobHuntDatabase,
  input: {
    company: Company;
    source: string;
    postings: readonly ObservedPosting[];
    observedAt: Date;
  },
): Promise<JobIngestSummary> {
  return db.transaction((tx) => {
    const summary = writeObservedPostings(tx, input);
    mergeSummary(
      summary,
      markMissingSourceJobsInTransaction(tx, {
        companyId: input.company.id,
        source: input.source,
        observedAt: input.observedAt,
      }),
    );
    return summary;
  });
}

export async function markMissingSourceJobs(
  db: JobHuntDatabase,
  input: { companyId: number; source: string; observedAt: Date },
): Promise<Pick<JobIngestSummary, "canonicalized" | "firstMissing" | "closed">> {
  return markMissingSourceJobsInTransaction(db, input);
}
