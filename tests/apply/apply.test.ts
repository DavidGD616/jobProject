import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } from "@/db/schema";
import { updateResumeVariantCoverLetter } from "@/db";
import { adapterForUrl, fillApplicationPlan, fillApplicationRun, isApplicationRunStale, prepareApplication } from "@/apply";
import { saveProfile } from "@/matching";
import { createApplication } from "@/tracking";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("ATS adapters prepare fields and enforce the human submission stop", async () => {
  assert.equal(adapterForUrl("https://boards.greenhouse.io/acme/jobs/1").id, "greenhouse");
  assert.equal(adapterForUrl("https://jobs.lever.co/acme/1").id, "lever");
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", atsType: "greenhouse", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const job = db.insert(jobs).values({ companyId: company.id, source: "greenhouse", sourceId: "1", url: "https://boards.greenhouse.io/acme/jobs/1", title: "Engineer", titleNorm: "engineer", description: "Build.", firstSeenAt: now, lastSeenAt: now, contentHash: "1" }).returning().get()!;
    const profile = saveProfile({ resumeJson: { name: "Taylor", email: "taylor@example.com", experience: [], education: [], projects: [] }, skills: [], titleAliases: [], skillAliases: {}, preferences: {} }, db, now);
    const application = createApplication({ jobId: job.id, database: db, now });
    const result = await prepareApplication({ applicationId: application.id, profile, database: db, now });
    assert.equal(result.run.status, "ready_for_review");
    assert.equal(result.plan.submissionBlocked, true);
    assert.equal(result.plan.fields.find((field) => field.key === "email")?.value, "taylor@example.com");
    assert.ok(result.plan.customQuestions.length > 0);
  } finally {
    sqlite.close();
  }
});

test("prepared application runs retain material provenance and become stale after changes", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", atsType: "greenhouse", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const job = db.insert(jobs).values({ companyId: company.id, source: "greenhouse", sourceId: "stale-1", url: "https://boards.greenhouse.io/acme/jobs/stale-1", title: "Engineer", titleNorm: "engineer", description: "Build TypeScript systems.", firstSeenAt: now, lastSeenAt: now, contentHash: "job-v1" }).returning().get()!;
    const profileInput = {
      resumeJson: { name: "Taylor", email: "taylor@example.com", experience: [], education: [], projects: [] },
      skills: ["typescript"],
      titleAliases: [],
      skillAliases: {},
      preferences: {},
    };
    let profile = saveProfile(profileInput, db, now);
    const firstVariant = db.insert(resumeVariants).values({
      jobId: job.id,
      resumeJson: profile.resumeJson,
      coverLetter: "Initial reviewed letter.",
      pdfPath: "/tmp/first.pdf",
      profileVersion: profile.version,
      jobContentHash: job.contentHash,
      promptVersion: "tailor-v3",
      evidenceMap: [],
      fitAssessment: { level: "strong", summary: "Relevant evidence is present.", gaps: [], evidenceCount: 1 },
      createdAt: now,
    }).returning().get()!;
    const application = createApplication({ jobId: job.id, database: db, now });
    db.update(applications).set({
      resumeVariantId: firstVariant.id,
      coverLetter: firstVariant.coverLetter,
      updatedAt: now,
    }).where(eq(applications.id, application.id)).run();

    const firstRun = await prepareApplication({ applicationId: application.id, profile, database: db, now });
    assert.equal(isApplicationRunStale(firstRun.run, firstVariant, job, profile), false);
    assert.deepEqual(firstRun.run.fields.materialSnapshot, {
      resumeVariantId: firstVariant.id,
      profileVersion: profile.version,
      jobContentHash: "job-v1",
      promptVersion: "tailor-v3",
      coverLetterHash: "0fb6e151efea6714581c5ccba08cc3e393ba1947bc1b9d3a765309b4b322b0ad",
    });

    const editedVariant = updateResumeVariantCoverLetter({
      variantId: firstVariant.id,
      coverLetter: "Human-reviewed replacement letter.",
      database: db,
      now: new Date(now.valueOf() + 1_000),
    });
    assert.equal(isApplicationRunStale(firstRun.run, editedVariant, job, profile), true);

    const currentRun = await prepareApplication({ applicationId: application.id, profile, database: db, now: new Date(now.valueOf() + 2_000) });
    assert.equal(isApplicationRunStale(currentRun.run, editedVariant, job, profile), false);

    const replacementVariant = db.insert(resumeVariants).values({
      jobId: job.id,
      resumeJson: profile.resumeJson,
      coverLetter: "Replacement material letter.",
      pdfPath: "/tmp/replacement.pdf",
      profileVersion: profile.version,
      jobContentHash: job.contentHash,
      promptVersion: "tailor-v3",
      evidenceMap: [],
      fitAssessment: { level: "strong", summary: "Relevant evidence is present.", gaps: [], evidenceCount: 1 },
      createdAt: new Date(now.valueOf() + 3_000),
    }).returning().get()!;
    db.update(applications).set({
      resumeVariantId: replacementVariant.id,
      coverLetter: replacementVariant.coverLetter,
      updatedAt: new Date(now.valueOf() + 3_000),
    }).where(eq(applications.id, application.id)).run();
    assert.equal(isApplicationRunStale(currentRun.run, replacementVariant, job, profile), true);

    const replacementRun = await prepareApplication({ applicationId: application.id, profile, database: db, now: new Date(now.valueOf() + 4_000) });
    assert.equal(isApplicationRunStale(replacementRun.run, replacementVariant, job, profile), false);

    const changedJob = db.update(jobs).set({ contentHash: "job-v2" }).where(eq(jobs.id, job.id)).returning().get()!;
    assert.equal(isApplicationRunStale(replacementRun.run, replacementVariant, changedJob, profile), true);
    db.update(jobs).set({ contentHash: job.contentHash }).where(eq(jobs.id, job.id)).run();
    profile = saveProfile(profileInput, db, new Date(now.valueOf() + 5_000));
    assert.equal(isApplicationRunStale(replacementRun.run, replacementVariant, job, profile), true);

    const legacyRun = db.insert(applicationRuns).values({
      applicationId: application.id,
      adapter: "greenhouse",
      status: "ready_for_review",
      fields: {
        adapter: "greenhouse",
        url: job.url,
        fields: [],
        customQuestions: [],
        submissionBlocked: true,
        instructions: [],
      },
      startedAt: now,
      finishedAt: now,
      error: null,
    }).returning().get()!;
    assert.equal(isApplicationRunStale(legacyRun, replacementVariant, job, profile), true);
  } finally {
    sqlite.close();
  }
});

test("browser boundary fills only declared fields and has no submit operation", async () => {
  const calls: string[] = [];
  const page = {
    goto: async (url: string) => { calls.push(`goto:${url}`); },
    fill: async (selector: string, value: string) => { calls.push(`fill:${selector}:${value}`); },
    setInputFiles: async (selector: string, path: string) => { calls.push(`file:${selector}:${path}`); },
  };
  const result = await fillApplicationPlan(page, {
    adapter: "greenhouse",
    url: "https://example.com/apply",
    fields: [
      { key: "email", label: "Email", value: "a@example.com", selector: "#email", required: true, source: "profile" },
      { key: "resume", label: "Resume", value: "/tmp/resume.pdf", selector: "input[type=file]", required: true, source: "resume_variant" },
      { key: "question", label: "Question", value: null, selector: null, required: true, source: "human" },
    ],
    customQuestions: [], submissionBlocked: true, instructions: [],
  });
  assert.deepEqual(result, { filled: ["email", "resume"], skipped: ["question"], submissionBlocked: true });
  assert.equal(calls.length, 3);
});

test("persisted browser runs update status after declared fields are filled", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const job = db.insert(jobs).values({ companyId: company.id, source: "greenhouse", sourceId: "1", url: "https://boards.greenhouse.io/acme/jobs/1", title: "Engineer", titleNorm: "engineer", description: "Build.", firstSeenAt: now, lastSeenAt: now, contentHash: "1" }).returning().get()!;
    const application = createApplication({ jobId: job.id, database: db, now });
    const run = db.insert(applicationRuns).values({
      applicationId: application.id,
      adapter: "greenhouse",
      status: "ready_for_review",
      fields: {
        adapter: "greenhouse",
        url: job.url,
        fields: [{ key: "email", label: "Email", value: "a@example.com", selector: "#email", required: true, source: "profile" }],
        customQuestions: [],
        submissionBlocked: true,
        instructions: [],
        materialSnapshot: {
          resumeVariantId: null,
          profileVersion: null,
          jobContentHash: null,
          promptVersion: null,
          coverLetterHash: "legacy-material-placeholder",
        },
      },
      startedAt: now,
      finishedAt: now,
      error: null,
    }).returning().get()!;
    const calls: string[] = [];
    const result = await fillApplicationRun({
      runId: run.id,
      database: db,
      now,
      page: {
        goto: async (url) => { calls.push(`goto:${url}`); },
        fill: async (selector, value) => { calls.push(`fill:${selector}:${value}`); },
        setInputFiles: async () => { calls.push("file"); },
      },
    });
    assert.deepEqual(result, { runId: run.id, filled: ["email"], skipped: [], submissionBlocked: true });
    assert.equal(db.select().from(applicationRuns).get()?.status, "filled_for_review");
    assert.deepEqual(db.select().from(applicationRuns).get()?.fields.materialSnapshot, {
      resumeVariantId: null,
      profileVersion: null,
      jobContentHash: null,
      promptVersion: null,
      coverLetterHash: "legacy-material-placeholder",
    });
    assert.deepEqual(calls, [`goto:${job.url}`, "fill:#email:a@example.com"]);
  } finally {
    sqlite.close();
  }
});
