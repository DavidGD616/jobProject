import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";
import { ensureActiveProfile, expandProfileQuery, fewShotExamples } from "@/matching";
import type { LlmProvider, ProviderResult } from "@/llm";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("query expansion is cached by profile version and human examples are available", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const profile = ensureActiveProfile(db, now);
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const job = db.insert(jobs).values({ companyId: company.id, source: "test", sourceId: "1", url: "https://example.com/1", title: "Engineer", titleNorm: "engineer", description: "Build.", firstSeenAt: now, lastSeenAt: now, contentHash: "1" }).returning().get()!;
    db.insert(triage).values({ jobId: job.id, profileId: profile.id, decision: "interested", decidedAt: now }).run();
    assert.equal(fewShotExamples(profile.id, db)[0]?.title, "Engineer");
    const provider: LlmProvider = {
      id: "claude", defaultModel: "fake", capabilities: () => ({ structuredOutput: false, maxPromptChars: 10_000, concurrency: 1 }), health: async () => true,
      run: async () => ({ text: '{"terms":[{"term":"distributed systems","weight":3}]}', raw: "", provider: "claude", model: "fake", cliVersion: "fake", durationMs: 1 } satisfies ProviderResult),
    };
    const expanded = await expandProfileQuery({ profile, database: db, allowLlm: true, providers: [provider], now });
    assert.equal(expanded.queryTerms["distributed systems"], 3);
  } finally {
    sqlite.close();
  }
});
