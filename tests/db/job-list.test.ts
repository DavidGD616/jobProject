import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { listOpenJobs, parseJobListFilters } from "@/db/job-list";
import { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("job-list filters return only active, open canonical, unblocked jobs", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const [acme, blocked, inactive] = await db
      .insert(companies)
      .values([
        {
          name: "Acme",
          slug: "acme",
          atsType: "greenhouse",
          discoveredVia: "test",
          discoveredAt: now,
          createdAt: now,
        },
        {
          name: "Blocked Co",
          slug: "blocked-co",
          atsType: "greenhouse",
          blocked: true,
          discoveredVia: "test",
          discoveredAt: now,
          createdAt: now,
        },
        {
          name: "Inactive Co",
          slug: "inactive-co",
          atsType: "greenhouse",
          active: false,
          discoveredVia: "test",
          discoveredAt: now,
          createdAt: now,
        },
      ])
      .returning();
    const [canonical] = await db
      .insert(jobs)
      .values({
        companyId: acme!.id,
        source: "greenhouse",
        sourceId: "canonical",
        url: "https://example.com/canonical",
        title: "Product Designer",
        titleNorm: "product designer",
        description: "Design durable workflows.",
        remoteType: "remote",
        postedAt: new Date("2026-08-16T12:00:00.000Z"),
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: "canonical-hash",
      })
      .returning();
    await db.insert(jobs).values([
      {
        companyId: acme!.id,
        source: "lever",
        sourceId: "duplicate",
        url: "https://example.com/duplicate",
        title: "Product Designer",
        titleNorm: "product designer",
        description: "Design durable workflows.",
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: "canonical-hash",
        canonicalId: canonical!.id,
      },
      {
        companyId: acme!.id,
        source: "greenhouse",
        sourceId: "closed",
        url: "https://example.com/closed",
        title: "Closed Role",
        titleNorm: "closed role",
        description: "Closed.",
        firstSeenAt: now,
        lastSeenAt: now,
        closedAt: now,
        contentHash: "closed-hash",
      },
      {
        companyId: blocked!.id,
        source: "greenhouse",
        sourceId: "blocked",
        url: "https://example.com/blocked",
        title: "Product Manager",
        titleNorm: "product manager",
        description: "Blocked.",
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: "blocked-hash",
      },
      {
        companyId: inactive!.id,
        source: "greenhouse",
        sourceId: "inactive",
        url: "https://example.com/inactive",
        title: "Inactive Role",
        titleNorm: "inactive role",
        description: "The board is no longer available.",
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: "inactive-hash",
      },
    ]);

    const all = listOpenJobs(parseJobListFilters({}), now, db);
    assert.equal(all.total, 1);
    assert.deepEqual(all.jobs.map((job) => job.title), ["Product Designer"]);

    const title = listOpenJobs(
      parseJobListFilters({ title: "designer", date: "7d" }),
      now,
      db,
    );
    assert.equal(title.total, 1);
    const absent = listOpenJobs(
      parseJobListFilters({ company: "acme", title: "engineer" }),
      now,
      db,
    );
    assert.equal(absent.total, 0);
  } finally {
    sqlite.close();
  }
});

test("job-list filter parsing bounds user input and rejects unknown date windows", () => {
  const parsed = parseJobListFilters({
    company: ["acme", "ignored"],
    title: "  product  ",
    date: "made-up",
  });
  assert.deepEqual(parsed, {
    company: "acme",
    title: "product",
    dateWindow: "all",
  });
});
