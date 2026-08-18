import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { parseArgs, runFreshStart } from "@/reset/cli";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("fresh-start CLI requires an explicit destructive option", () => {
  assert.deepEqual(parseArgs(["--", "--fresh-start"]), { freshStart: true, help: false });
  assert.deepEqual(parseArgs(["--help"]), { freshStart: false, help: true });
  assert.throws(() => parseArgs([]), /--fresh-start/);
  assert.throws(() => parseArgs(["--unknown"]), /Unknown option/);
});

test("fresh-start clears saved applications and interested materials while retaining profile, catalog, matches, and other decisions", async () => {
  const { db, sqlite } = createTestDatabase();
  const exportDirectory = await mkdtemp(join(tmpdir(), "job-hunt-fresh-start-exports-"));
  const outsideDirectory = await mkdtemp(join(tmpdir(), "job-hunt-fresh-start-outside-"));
  try {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const company = db.insert(schema.companies).values({
      name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    const [applicationJob, interestedJob, skipJob] = db.insert(schema.jobs).values([
      {
        companyId: company.id, source: "test", sourceId: "application", url: "https://example.com/application",
        title: "Application Engineer", titleNorm: "application engineer", description: "Build durable software.",
        firstSeenAt: now, lastSeenAt: now, contentHash: "application-v1",
      },
      {
        companyId: company.id, source: "test", sourceId: "interested", url: "https://example.com/interested",
        title: "Interested Engineer", titleNorm: "interested engineer", description: "Build product features.",
        firstSeenAt: now, lastSeenAt: now, contentHash: "interested-v1",
      },
      {
        companyId: company.id, source: "test", sourceId: "skip", url: "https://example.com/skip",
        title: "Skip Engineer", titleNorm: "skip engineer", description: "Build unrelated systems.",
        firstSeenAt: now, lastSeenAt: now, contentHash: "skip-v1",
      },
    ]).returning().all();
    const profile = db.insert(schema.profiles).values({
      version: 3,
      resumeJson: { name: "Taylor", experience: [], education: [], projects: [] },
      skills: ["typescript"],
      titleAliases: ["software engineer"],
      skillAliases: {},
      queryTerms: { typescript: 2 },
      preferences: { remoteTypes: ["remote"] },
      updatedAt: now,
    }).returning().get()!;

    for (const [index, job] of [applicationJob, interestedJob, skipJob].entries()) {
      db.insert(schema.matches).values({
        jobId: job!.id,
        profileId: profile.id,
        profileVersion: profile.version,
        lexicalScore: 0.5 + index / 10,
        featureScore: 0.6,
        retrievalScore: 0.7,
        llmScore: 70,
        learnedScore: 80 - index,
        reasoning: "Saved match reasoning.",
        gaps: [],
        strengths: ["TypeScript"],
        flags: [],
        scoredAt: now,
      }).run();
    }

    const firstVariant = db.insert(schema.resumeVariants).values({
      jobId: applicationJob!.id,
      resumeJson: profile.resumeJson,
      pdfPath: join(exportDirectory, "resume-variant-1.pdf"),
      createdAt: now,
    }).returning().get()!;
    const outsidePdfPath = join(outsideDirectory, "resume-variant-2.pdf");
    const secondVariant = db.insert(schema.resumeVariants).values({
      jobId: interestedJob!.id,
      resumeJson: profile.resumeJson,
      pdfPath: outsidePdfPath,
      createdAt: new Date(now.valueOf() + 1_000),
    }).returning().get()!;
    const application = db.insert(schema.applications).values({
      jobId: applicationJob!.id,
      status: "ready",
      resumeVariantId: firstVariant.id,
      coverLetter: "Saved letter.",
      createdAt: now,
      updatedAt: now,
    }).returning().get()!;
    db.insert(schema.events).values([
      { applicationId: application.id, type: "created", occurredAt: now, payload: {} },
      { applicationId: application.id, type: "status_change", occurredAt: now, payload: { to: "ready" } },
    ]).run();
    db.insert(schema.applicationRuns).values({
      applicationId: application.id,
      adapter: "greenhouse",
      status: "ready_for_review",
      fields: { materialSnapshot: { resumeVariantId: firstVariant.id } },
      startedAt: now,
      finishedAt: now,
    }).run();
    db.insert(schema.tailorRequests).values([
      { jobId: applicationJob!.id, status: "completed", variantId: firstVariant.id, createdAt: now },
      { jobId: interestedJob!.id, status: "queued", variantId: secondVariant.id, createdAt: now },
    ]).run();
    db.insert(schema.triage).values([
      { jobId: applicationJob!.id, profileId: profile.id, decision: "interested", decidedAt: now },
      { jobId: interestedJob!.id, profileId: profile.id, decision: "interested", decidedAt: now },
      { jobId: skipJob!.id, profileId: profile.id, decision: "skip", decidedAt: now },
      { jobId: skipJob!.id, profileId: profile.id, decision: "block_company", decidedAt: now },
    ]).run();
    db.insert(schema.rankingFeedback).values([
      {
        jobId: applicationJob!.id, profileId: profile.id, outcome: "applied",
        features: { lexical: 0.5, feature: 0.6, retrieval: 0.7, llm: 0.7 }, retrievalScore: 0.7, llmScore: 70, createdAt: now,
      },
      {
        jobId: interestedJob!.id, profileId: profile.id, outcome: "interested",
        features: { lexical: 0.6, feature: 0.6, retrieval: 0.7, llm: 0.7 }, retrievalScore: 0.7, llmScore: 70, createdAt: now,
      },
      {
        jobId: skipJob!.id, profileId: profile.id, outcome: "skip",
        features: { lexical: 0.7, feature: 0.6, retrieval: 0.7, llm: 0.7 }, retrievalScore: 0.7, llmScore: 70, createdAt: now,
      },
    ]).run();

    const htmlPath = join(exportDirectory, `resume-variant-${firstVariant.id}.html`);
    const pdfPath = join(exportDirectory, `resume-variant-${firstVariant.id}.pdf`);
    await writeFile(htmlPath, "generated resume", "utf8");
    await writeFile(pdfPath, "generated PDF", "utf8");
    await writeFile(outsidePdfPath, "do not remove", "utf8");

    const result = await runFreshStart({ database: db, exportDirectory });

    assert.deepEqual(result, {
      applicationsCleared: 1,
      applicationRunsCleared: 1,
      eventsCleared: 2,
      interestedTriageCleared: 2,
      rankingFeedbackCleared: 2,
      learnedScoresReset: 3,
      tailorRequestsCleared: 2,
      resumeVariantsCleared: 2,
      filesRemoved: [htmlPath, pdfPath],
    });
    assert.equal(db.select().from(schema.applications).all().length, 0);
    assert.equal(db.select().from(schema.applicationRuns).all().length, 0);
    assert.equal(db.select().from(schema.events).all().length, 0);
    assert.equal(db.select().from(schema.tailorRequests).all().length, 0);
    assert.equal(db.select().from(schema.resumeVariants).all().length, 0);
    assert.deepEqual(db.select().from(schema.triage).all().map((row) => row.decision), ["skip", "block_company"]);
    assert.deepEqual(db.select().from(schema.rankingFeedback).all().map((row) => row.outcome), ["skip"]);
    assert.deepEqual(db.select().from(schema.matches).all().map((row) => row.learnedScore), [null, null, null]);
    assert.deepEqual(db.select().from(schema.profiles).get(), profile);
    assert.equal(db.select().from(schema.companies).get()?.id, company.id);
    assert.equal(db.select().from(schema.jobs).all().length, 3);
    assert.equal(db.select().from(schema.matches).all().length, 3);
    await assert.rejects(access(htmlPath));
    await assert.rejects(access(pdfPath));
    assert.equal(await readFile(outsidePdfPath, "utf8"), "do not remove");

    assert.deepEqual(await runFreshStart({ database: db, exportDirectory }), {
      applicationsCleared: 0,
      applicationRunsCleared: 0,
      eventsCleared: 0,
      interestedTriageCleared: 0,
      rankingFeedbackCleared: 0,
      learnedScoresReset: 0,
      tailorRequestsCleared: 0,
      resumeVariantsCleared: 0,
      filesRemoved: [],
    });
  } finally {
    sqlite.close();
    await rm(exportDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});
