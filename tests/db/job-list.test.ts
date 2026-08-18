import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { listOpenJobs, parseJobListFilters } from "@/db/job-list";
import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } from "@/db/schema";
import { saveProfile } from "@/matching";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } });
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

    const all = listOpenJobs(
      parseJobListFilters({ scope: "all" }),
      { now, database: db },
    );
    assert.equal(all.total, 1);
    assert.deepEqual(all.jobs.map((job) => job.title), ["Product Designer"]);

    const title = listOpenJobs(
      parseJobListFilters({ scope: "all", title: "designer", date: "7d" }),
      { now, database: db },
    );
    assert.equal(title.total, 1);
    const absent = listOpenJobs(
      parseJobListFilters({ scope: "all", company: "acme", title: "engineer" }),
      { now, database: db },
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
    scope: "profile",
  });
});

test("profile scope keeps a broad profile-guided candidate pool separate from all jobs", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme Labs",
      slug: "acme-labs",
      discoveredVia: "test",
      discoveredAt: now,
      createdAt: now,
    }).returning().get()!;
    db.insert(jobs).values([
      {
        companyId: company.id,
        source: "test",
        sourceId: "title-match",
        url: "https://example.com/title",
        title: "Frontend Software Engineer",
        titleNorm: "frontend software engineer",
        description: "Build React and TypeScript applications.",
        location: "San Diego, California",
        remoteType: "hybrid",
        firstSeenAt: now,
        lastSeenAt: now,
        postedAt: now,
        contentHash: "title-match",
      },
      {
        companyId: company.id,
        source: "test",
        sourceId: "skill-match",
        url: "https://example.com/skill",
        title: "Product Platform Engineer",
        titleNorm: "product platform engineer",
        description: "Build TypeScript services for a product platform.",
        location: "Seattle, Washington",
        remoteType: "onsite",
        firstSeenAt: now,
        lastSeenAt: now,
        postedAt: now,
        contentHash: "skill-match",
      },
      {
        companyId: company.id,
        source: "test",
        sourceId: "unrelated",
        url: "https://example.com/unrelated",
        title: "Office Coordinator",
        titleNorm: "office coordinator",
        description: "Coordinate office supplies and vendor visits.",
        firstSeenAt: now,
        lastSeenAt: now,
        postedAt: now,
        contentHash: "unrelated",
      },
    ]).run();
    const profile = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["TypeScript", "React"],
      titleAliases: ["software engineer", "frontend developer"],
      skillAliases: {},
      preferences: {
        locations: ["San Diego, California"],
        remoteTypes: ["remote", "hybrid", "onsite"],
      },
    }, db, now);

    const profileJobs = listOpenJobs(
      parseJobListFilters({}),
      { now, database: db, profile },
    );
    assert.equal(profileJobs.total, 2);
    assert.deepEqual(
      profileJobs.jobs.map((job) => job.title),
      ["Frontend Software Engineer", "Product Platform Engineer"],
    );

    const allJobs = listOpenJobs(
      parseJobListFilters({ scope: "all" }),
      { now, database: db, profile },
    );
    assert.equal(allJobs.total, 3);
  } finally {
    sqlite.close();
  }
});

test("profile-scope filters are applied before the lexical scan cap", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme Labs", slug: "acme-labs", discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    const filler = Array.from({ length: 1_500 }, (_, index) => ({
      companyId: company.id,
      source: "test",
      sourceId: `filler-${index}`,
      url: `https://example.com/filler-${index}`,
      title: "General role",
      titleNorm: "general role",
      description: "Work with TypeScript.",
      firstSeenAt: now,
      lastSeenAt: now,
      postedAt: now,
      contentHash: `filler-${index}`,
    }));
    filler.push({
      companyId: company.id,
      source: "test",
      sourceId: "needle",
      url: "https://example.com/needle",
      title: "Needle role",
      titleNorm: "needle role",
      description: "Work with TypeScript.",
      firstSeenAt: now,
      lastSeenAt: now,
      postedAt: now,
      contentHash: "needle",
    });
    db.insert(jobs).values(filler).run();
    const profile = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["TypeScript"], titleAliases: [], skillAliases: {}, preferences: {},
    }, db, now);

    const result = listOpenJobs(
      parseJobListFilters({ title: "needle" }),
      { now, database: db, profile },
    );
    assert.deepEqual(result.jobs.map((job) => job.title), ["Needle role"]);
    assert.equal(result.total, 1);
  } finally {
    sqlite.close();
  }
});
