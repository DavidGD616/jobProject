import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";
import { ensureActiveProfile } from "@/matching";
import { runLearning, trainLogisticModel } from "@/learning";
import { createApplication, updateApplication } from "@/tracking";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("the learned model waits for labels and then blends a bounded score", () => {
  assert.equal(trainLogisticModel([{ outcome: "interested", features: { lexical: 1, feature: 1, retrieval: 1, llm: 1 } }]), null);
  const examples = Array.from({ length: 6 }, (_, index) => ({ outcome: index < 3 ? "interested" : "skip", features: { lexical: index < 3 ? 0.9 : 0.1, feature: 0.8, retrieval: index < 3 ? 0.8 : 0.2, llm: index < 3 ? 0.9 : 0.2 } }));
  const model = trainLogisticModel(examples);
  assert.ok(model);
});

test("application outcomes become feedback and update match learned scores", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const profile = ensureActiveProfile(db, now);
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    for (let index = 0; index < 6; index += 1) {
      const job = db.insert(jobs).values({ companyId: company.id, source: "test", sourceId: String(index), url: `https://example.com/${index}`, title: "Engineer", titleNorm: "engineer", description: "Build.", firstSeenAt: now, lastSeenAt: now, contentHash: String(index) }).returning().get()!;
      db.insert(matches).values({ jobId: job.id, profileId: profile.id, profileVersion: profile.version, lexicalScore: index < 3 ? 0.9 : 0.1, featureScore: 0.8, retrievalScore: index < 3 ? 0.85 : 0.2, llmScore: index < 3 ? 90 : 20, learnedScore: null, gaps: [], strengths: [], flags: [], scoredAt: now }).run();
      const application = createApplication({ jobId: job.id, database: db, now });
      updateApplication({ id: application.id, status: index < 3 ? "applied" : "rejected", database: db, now });
    }
    const result = runLearning(profile.id, db, now);
    assert.equal(result.inserted, 6);
    assert.ok(result.model);
    assert.equal(result.updated, 6);
    const scores = db.select().from(matches).all().map((row) => row.learnedScore ?? 0);
    assert.ok(Math.max(...scores) > Math.min(...scores));
  } finally {
    sqlite.close();
  }
});
