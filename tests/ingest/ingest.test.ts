import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

import {
  ingestObservedPostings,
  markMissingSourceJobs,
} from "@/db/jobs";
import { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";
import { applyIngestHeuristics, contentHash } from "@/ingest";
import type { NormalizedPosting } from "@/sources";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, {
    schema: { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage },
  });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

async function createCompany(
  db: ReturnType<typeof createTestDatabase>["db"],
) {
  const now = new Date("2026-08-17T12:00:00.000Z");
  const inserted = await db
    .insert(companies)
    .values({
      name: "Acme Labs",
      slug: "acme-labs",
      atsType: "greenhouse",
      atsToken: "acme",
      careersUrl: "https://boards.greenhouse.io/acme",
      discoveredVia: "test",
      discoveredAt: now,
      createdAt: now,
    })
    .returning();
  return inserted[0]!;
}

const productRole: NormalizedPosting = {
  url: "https://example.com/jobs/123",
  title: "Senior Product Engineer — Remote",
  titleNorm: "product engineer",
  description:
    "This distributed team offers a base salary of USD 120k–USD 160k/year.",
  location: null,
  remoteType: "unknown",
  postedAt: new Date("2026-08-01T00:00:00.000Z"),
};

test("ingest heuristics only fill source-absent fields", () => {
  const extracted = applyIngestHeuristics(productRole);

  assert.equal(extracted.seniority, "senior");
  assert.equal(extracted.remoteType, "remote");
  assert.equal(extracted.salaryMin, 120_000);
  assert.equal(extracted.salaryMax, 160_000);
  assert.equal(extracted.currency, "USD");
  assert.equal(extracted.salaryPeriod, "year");
  assert.equal(extracted.extractionTier, "heuristic");
  assert.equal(
    contentHash({
      titleNorm: productRole.titleNorm,
      companySlug: "acme-labs",
      description: productRole.description,
    }),
    contentHash({
      titleNorm: productRole.titleNorm,
      companySlug: "acme-labs",
      description: productRole.description,
    }),
  );
});

test("ingest upserts observations, links content duplicates, and closes only after two absences", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const company = await createCompany(db);
    const firstSeen = new Date("2026-08-17T12:00:00.000Z");
    const refreshedAt = new Date("2026-08-17T18:00:00.000Z");

    const first = await ingestObservedPostings(db, {
      company,
      source: "greenhouse",
      observedAt: firstSeen,
      postings: [{ sourceId: "gh-123", posting: productRole }],
    });
    assert.deepEqual(first, {
      inserted: 1,
      updated: 0,
      canonicalized: 0,
      firstMissing: 0,
      closed: 0,
    });

    const refreshed = await ingestObservedPostings(db, {
      company,
      source: "greenhouse",
      observedAt: refreshedAt,
      postings: [{ sourceId: "gh-123", posting: productRole }],
    });
    assert.equal(refreshed.inserted, 0);
    assert.equal(refreshed.updated, 1);

    const duplicate = await ingestObservedPostings(db, {
      company,
      source: "ashby",
      observedAt: refreshedAt,
      postings: [{ sourceId: "ashby-123", posting: productRole }],
    });
    assert.equal(duplicate.inserted, 1);
    assert.equal(duplicate.canonicalized, 1);

    const stored = await db
      .select()
      .from(jobs)
      .where(eq(jobs.companyId, company.id))
      .orderBy(jobs.id);
    assert.equal(stored.length, 2);
    assert.equal(stored[0]!.firstSeenAt.valueOf(), firstSeen.valueOf());
    assert.equal(stored[0]!.lastSeenAt.valueOf(), refreshedAt.valueOf());
    assert.equal(stored[0]!.seniority, "senior");
    assert.equal(stored[0]!.remoteType, "remote");
    assert.equal(stored[0]!.salaryMin, 120_000);
    assert.equal(stored[1]!.canonicalId, stored[0]!.id);

    const firstMissing = await markMissingSourceJobs(db, {
      companyId: company.id,
      source: "greenhouse",
      observedAt: new Date("2026-08-18T00:00:00.000Z"),
    });
    assert.deepEqual(firstMissing, {
      canonicalized: 0,
      firstMissing: 1,
      closed: 0,
    });

    const closed = await markMissingSourceJobs(db, {
      companyId: company.id,
      source: "greenhouse",
      observedAt: new Date("2026-08-18T06:00:00.000Z"),
    });
    assert.deepEqual(closed, {
      canonicalized: 1,
      firstMissing: 0,
      closed: 1,
    });

    const afterClosing = await db
      .select({ id: jobs.id, canonicalId: jobs.canonicalId, closedAt: jobs.closedAt })
      .from(jobs)
      .where(eq(jobs.companyId, company.id))
      .orderBy(jobs.id);
    assert.notEqual(afterClosing[0]!.closedAt, null);
    assert.equal(afterClosing[0]!.canonicalId, afterClosing[1]!.id);
    assert.equal(afterClosing[1]!.canonicalId, null);

    const reopened = await ingestObservedPostings(db, {
      company,
      source: "greenhouse",
      observedAt: new Date("2026-08-18T12:00:00.000Z"),
      postings: [{ sourceId: "gh-123", posting: productRole }],
    });
    assert.equal(reopened.updated, 1);

    const current = await db
      .select({ closedAt: jobs.closedAt, missingSinceAt: jobs.missingSinceAt })
      .from(jobs)
      .where(eq(jobs.sourceId, "gh-123"));
    assert.equal(current[0]!.closedAt, null);
    assert.equal(current[0]!.missingSinceAt, null);
  } finally {
    sqlite.close();
  }
});
