import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";
import {
  ensureActiveProfile,
  recordTriage,
  retrieveMatches,
  rerankMatches,
  saveProfile,
} from "@/matching";
import type { LlmProvider, ProviderResult } from "@/llm";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

function fakeProvider(text: string): LlmProvider {
  const result: ProviderResult = {
    text,
    raw: text,
    provider: "claude",
    model: "fake",
    cliVersion: "fake-1",
    durationMs: 1,
  };
  return {
    id: "claude",
    defaultModel: "fake",
    capabilities: () => ({ structuredOutput: false, maxPromptChars: 50_000, concurrency: 1 }),
    health: async () => true,
    run: async () => result,
  };
}

test("profile versions invalidate retrieval rows and lexical matching is explainable", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme Labs", slug: "acme-labs", tier: 1, active: true, blocked: false,
      discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    db.insert(jobs).values([
      {
        companyId: company.id, source: "test", sourceId: "good", url: "https://example.com/good",
        title: "Senior TypeScript Engineer", titleNorm: "typescript engineer",
        description: "Build TypeScript services with PostgreSQL for a remote team.",
        stack: ["typescript", "postgresql"], remoteType: "remote", seniority: "senior",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "good",
      },
      {
        companyId: company.id, source: "test", sourceId: "bad", url: "https://example.com/bad",
        title: "Office Coordinator", titleNorm: "office coordinator",
        description: "Coordinate a busy office and vendors.", stack: [], remoteType: "onsite", seniority: "mid",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "bad",
      },
    ]).run();
    const profile = saveProfile({
      resumeJson: { name: "Taylor", experience: [], education: [], projects: [] },
      skills: ["TypeScript", "PostgreSQL"], titleAliases: ["software engineer"], skillAliases: {},
      preferences: { remoteTypes: ["remote"], seniorities: ["senior"] },
    }, db, now);
    const ranked = retrieveMatches(profile, { database: db, now, limit: 10 });
    assert.equal(ranked.length, 1);
    assert.equal(ranked[0]?.job.title, "Senior TypeScript Engineer");
    assert.ok(ranked[0]!.lexicalScore > 0.4);
    const changed = saveProfile({
      resumeJson: { name: "Taylor", experience: [], education: [], projects: [] },
      skills: ["office"], titleAliases: [], skillAliases: {}, preferences: {},
    }, db, new Date(now.valueOf() + 1_000));
    assert.equal(changed.version, profile.version + 1);
  } finally {
    sqlite.close();
  }
});

test("triage removes skipped roles and LLM rerank writes reasons plus extracted fields", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const job = db.insert(jobs).values({
      companyId: company.id, source: "test", sourceId: "role", url: "https://example.com/role",
      title: "Product Engineer", titleNorm: "product engineer", description: "Build product software with TypeScript.",
      stack: ["typescript"], firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "role",
    }).returning().get()!;
    const profile = ensureActiveProfile(db, now);
    const ranked = retrieveMatches(profile, { database: db, now });
    recordTriage({ jobId: job.id, profileId: profile.id, decision: "interested", database: db, now });
    const result = await rerankMatches({
      profile,
      matches: ranked,
      database: db,
      providers: [fakeProvider(`[{"job_id":${job.id},"score":88,"reasoning":"Strong TypeScript overlap","gaps":["No salary listed"],"strengths":["TypeScript"],"flags":[],"extracted":{"seniority":"mid","salary_min":100000,"salary_max":140000,"currency":"USD","stack":["typescript"]}}]`)],
    });
    assert.deepEqual(result, { scored: 1, failed: 0 });
    const stored = db.select().from(matches).get()!;
    assert.equal(stored.llmScore, 88);
    assert.equal(stored.reasoning, "Strong TypeScript overlap");
    assert.equal(db.select().from(jobs).get()?.salaryMin, 100000);
    recordTriage({ jobId: job.id, profileId: profile.id, decision: "skip", database: db, now: new Date(now.valueOf() + 1_000) });
    assert.equal(retrieveMatches(profile, { database: db, now }).length, 0);
  } finally {
    sqlite.close();
  }
});
