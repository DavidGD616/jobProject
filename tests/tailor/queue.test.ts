import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import {
  applications,
  companies,
  jobs,
  resumeVariants,
} from "@/db/schema";
import {
  claimNextTailorRequest,
  completeTailorRequest,
  enqueueTailorRequest,
  failTailorRequest,
  listTailorRequests,
} from "@/db/tailor-requests";
import { updateResumeVariantCoverLetter } from "@/db/resume-variants";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

function insertJob(db: ReturnType<typeof createTestDatabase>["db"], now: Date) {
  const company = db.insert(companies).values({
    name: "Acme",
    slug: "acme",
    discoveredVia: "test",
    discoveredAt: now,
    createdAt: now,
  }).returning().get()!;
  return db.insert(jobs).values({
    companyId: company.id,
    source: "test",
    sourceId: `job-${now.valueOf()}`,
    url: "https://example.com/jobs/1",
    title: "Engineer",
    titleNorm: "engineer",
    description: "Build durable software.",
    firstSeenAt: now,
    lastSeenAt: now,
    contentHash: `job-${now.valueOf()}`,
  }).returning().get()!;
}

test("tailor requests coalesce clicks and are completed only by the worker", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const firstTime = new Date("2026-08-17T12:00:00.000Z");
    const job = insertJob(db, firstTime);
    const first = enqueueTailorRequest({ jobId: job.id, database: db, now: firstTime });
    const duplicate = enqueueTailorRequest({ jobId: job.id, database: db, now: new Date(firstTime.valueOf() + 1_000) });
    assert.equal(duplicate.id, first.id);
    assert.equal(claimNextTailorRequest(db, new Date(firstTime.valueOf() + 2_000))?.status, "running");
    assert.equal(claimNextTailorRequest(db), null);
    const variant = db.insert(resumeVariants).values({
      jobId: job.id,
      resumeJson: { experience: [], education: [], projects: [] },
      coverLetter: null,
      pdfPath: null,
      createdAt: firstTime,
    }).returning().get()!;
    const completed = completeTailorRequest({ requestId: first.id, variantId: variant.id, database: db, now: new Date(firstTime.valueOf() + 3_000) });
    assert.equal(completed.status, "completed");
    assert.equal(completed.variantId, variant.id);
    const second = enqueueTailorRequest({ jobId: job.id, database: db, now: new Date(firstTime.valueOf() + 4_000) });
    assert.notEqual(second.id, first.id);
    assert.equal(listTailorRequests(job.id, db).map((request) => request.id).join(","), `${second.id},${first.id}`);
  } finally {
    sqlite.close();
  }
});

test("a failed worker run is visible and does not block a replacement request", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const job = insertJob(db, now);
    const queued = enqueueTailorRequest({ jobId: job.id, database: db, now });
    assert.equal(claimNextTailorRequest(db, now)?.id, queued.id);
    const failed = failTailorRequest({ requestId: queued.id, error: "Chromium is unavailable", database: db, now });
    assert.equal(failed.status, "failed");
    assert.equal(failed.error, "Chromium is unavailable");
    assert.notEqual(enqueueTailorRequest({ jobId: job.id, database: db, now: new Date(now.valueOf() + 1_000) }).id, queued.id);
  } finally {
    sqlite.close();
  }
});

test("editing a variant letter keeps the currently attached application in sync", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const job = insertJob(db, now);
    const variant = db.insert(resumeVariants).values({
      jobId: job.id,
      resumeJson: { experience: [], education: [], projects: [] },
      coverLetter: "Initial draft",
      pdfPath: null,
      profileVersion: 1,
      jobContentHash: job.contentHash,
      promptVersion: "tailor-v3",
      evidenceMap: [{ requirement: "Build software", source: "skill", label: "TypeScript", skill: "typescript" }],
      fitAssessment: { level: "strong", summary: "Relevant evidence is present.", gaps: [], evidenceCount: 1 },
      createdAt: now,
    }).returning().get()!;
    db.insert(applications).values({
      jobId: job.id,
      status: "draft",
      resumeVariantId: variant.id,
      coverLetter: "Initial draft",
      createdAt: now,
      updatedAt: now,
    }).returning().get()!;
    const edited = updateResumeVariantCoverLetter({
      variantId: variant.id,
      coverLetter: "  Human-reviewed letter.  ",
      database: db,
      now: new Date(now.valueOf() + 1_000),
    });
    assert.equal(edited.coverLetter, "Human-reviewed letter.");
    assert.equal(edited.profileVersion, 1);
    assert.equal(edited.jobContentHash, job.contentHash);
    assert.deepEqual(edited.evidenceMap, [{ requirement: "Build software", source: "skill", label: "TypeScript", skill: "typescript" }]);
    assert.equal(db.select().from(applications).get()?.coverLetter, "Human-reviewed letter.");
  } finally {
    sqlite.close();
  }
});
