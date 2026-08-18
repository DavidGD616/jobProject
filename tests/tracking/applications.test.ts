import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } from "@/db/schema";
import {
  appendEvent,
  createApplication,
  funnelStats,
  listApplications,
  listContacts,
  listEvents,
  saveContact,
  updateApplication,
} from "@/tracking";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("application status snapshots and append-only events remain queryable", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const job = db.insert(jobs).values({ companyId: company.id, source: "test", sourceId: "1", url: "https://example.com/1", title: "Engineer", titleNorm: "engineer", description: "Build things.", firstSeenAt: now, lastSeenAt: now, contentHash: "1" }).returning().get()!;
    const application = createApplication({ jobId: job.id, database: db, now });
    assert.equal(application.status, "draft");
    assert.equal(createApplication({ jobId: job.id, database: db, now }).id, application.id);
    updateApplication({ id: application.id, status: "applied", nextFollowupAt: new Date("2026-08-20T09:00:00.000Z"), database: db, now: new Date(now.valueOf() + 1_000) });
    appendEvent({ applicationId: application.id, type: "email", payload: { subject: "Thanks" }, database: db, now });
    assert.equal(listApplications({ database: db })[0]?.status, "applied");
    assert.equal(listEvents(application.id, db).length, 4);
    assert.equal(funnelStats(db).find((item) => item.status === "applied")?.count, 1);
    saveContact({ companyId: company.id, name: "Alex", role: "Recruiter", email: "alex@example.com", database: db, now });
    assert.equal(listContacts(db)[0]?.contact.name, "Alex");
  } finally {
    sqlite.close();
  }
});
