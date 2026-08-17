import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";
import { adapterForUrl, fillApplicationPlan, fillApplicationRun, prepareApplication } from "@/apply";
import { saveProfile } from "@/matching";
import { createApplication } from "@/tracking";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } });
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
    assert.deepEqual(calls, [`goto:${job.url}`, "fill:#email:a@example.com"]);
  } finally {
    sqlite.close();
  }
});
