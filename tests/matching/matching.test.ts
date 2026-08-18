import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } from "@/db/schema";
import {
  ensureActiveProfile,
  listRankedMatches,
  recordTriage,
  retrieveMatches,
  rerankMatches,
  saveProfile,
} from "@/matching";
import { parseArgs } from "@/matching/cli";
import type { LlmProvider, ProviderResult } from "@/llm";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

function fakeProvider(text: string, onPrompt?: (prompt: string) => void): LlmProvider {
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
    run: async (prompt) => {
      onPrompt?.(prompt);
      return result;
    },
  };
}

test("rank CLI accepts pnpm's argument separator", () => {
  assert.deepEqual(parseArgs(["--", "--limit", "20", "--rerank"]), {
    limit: 20,
    rerank: true,
    expand: false,
  });
});

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

test("friendly seniority preference labels match canonical job levels", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme Labs", slug: "acme-labs", tier: 1, active: true, blocked: false,
      discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    db.insert(jobs).values([
      {
        companyId: company.id, source: "test", sourceId: "junior", url: "https://example.com/junior",
        title: "Junior TypeScript Engineer", titleNorm: "junior typescript engineer",
        description: "Build TypeScript services.", remoteType: "remote", seniority: "junior",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "junior",
      },
      {
        companyId: company.id, source: "test", sourceId: "mid", url: "https://example.com/mid",
        title: "Mid-Level TypeScript Engineer", titleNorm: "mid level typescript engineer",
        description: "Build TypeScript services.", remoteType: "remote", seniority: "mid",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "mid",
      },
      {
        companyId: company.id, source: "test", sourceId: "senior", url: "https://example.com/senior",
        title: "Senior TypeScript Engineer", titleNorm: "senior typescript engineer",
        description: "Build TypeScript services.", remoteType: "remote", seniority: "senior",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "senior",
      },
    ]).run();
    const profile = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["typescript"], titleAliases: ["software engineer"], skillAliases: {},
      preferences: { remoteTypes: ["remote"], seniorities: ["entry level", "associate", "mid level"] },
    }, db, now);

    const ranked = retrieveMatches(profile, { database: db, now, limit: 10 });
    assert.deepEqual(
      new Set(ranked.map((match) => match.job.seniority)),
      new Set(["junior", "mid"]),
    );
  } finally {
    sqlite.close();
  }
});

test("an unsupported seniority preference remains a boundary", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme Labs", slug: "acme-labs", tier: 1, active: true, blocked: false,
      discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    db.insert(jobs).values([
      {
        companyId: company.id, source: "test", sourceId: "senior", url: "https://example.com/senior",
        title: "Senior TypeScript Engineer", titleNorm: "senior typescript engineer",
        description: "Build TypeScript services.", seniority: "senior",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "senior",
      },
      {
        companyId: company.id, source: "test", sourceId: "unknown", url: "https://example.com/unknown",
        title: "TypeScript Engineer", titleNorm: "typescript engineer",
        description: "Build TypeScript services.",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "unknown",
      },
    ]).run();
    const profile = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["typescript"], titleAliases: ["software engineer"], skillAliases: {},
      preferences: { seniorities: ["manager"] },
    }, db, now);

    const ranked = retrieveMatches(profile, { database: db, now, limit: 10 });
    assert.deepEqual(ranked.map((match) => match.job.seniority), [null]);
  } finally {
    sqlite.close();
  }
});

test("preferred companies do not become a strict gate", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const [ordinary, preferred] = db.insert(companies).values([
      { name: "Ordinary Co", slug: "ordinary-co", discoveredVia: "test", discoveredAt: now, createdAt: now },
      { name: "Preferred Co", slug: "preferred-co", discoveredVia: "test", discoveredAt: now, createdAt: now },
    ]).returning().all();
    db.insert(jobs).values([
      {
        companyId: ordinary!.id, source: "test", sourceId: "ordinary", url: "https://example.com/ordinary",
        title: "TypeScript Engineer", titleNorm: "typescript engineer", description: "Build TypeScript services.",
        remoteType: "remote", firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "ordinary",
      },
      {
        companyId: preferred!.id, source: "test", sourceId: "preferred", url: "https://example.com/preferred",
        title: "TypeScript Engineer", titleNorm: "typescript engineer", description: "Build TypeScript services.",
        remoteType: "remote", firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "preferred",
      },
    ]).run();
    const profile = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["typescript"],
      titleAliases: ["software engineer"],
      skillAliases: {},
      preferences: {
        remoteTypes: ["remote"],
        targetCompanies: ["Not In The Ledger"],
      },
    }, db, now);

    const ranked = retrieveMatches(profile, { database: db, now, limit: 10 });
    assert.equal(ranked.length, 2);
    assert.deepEqual(
      new Set(ranked.map((match) => match.company.name)),
      new Set(["Ordinary Co", "Preferred Co"]),
    );

    const boostedProfile = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["typescript"],
      titleAliases: ["software engineer"],
      skillAliases: {},
      preferences: { remoteTypes: ["remote"], targetCompanies: ["Preferred Co"] },
    }, db, new Date(now.valueOf() + 1_000));
    const boosted = retrieveMatches(boostedProfile, { database: db, now, limit: 10 });
    const preferredMatch = boosted.find((match) => match.company.name === "Preferred Co");
    const ordinaryMatch = boosted.find((match) => match.company.name === "Ordinary Co");
    assert.ok(preferredMatch && ordinaryMatch);
    assert.ok(preferredMatch.featureScore > ordinaryMatch.featureScore);
  } finally {
    sqlite.close();
  }
});

test("ranked views ignore matches from an earlier profile version", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    db.insert(jobs).values({
      companyId: company.id, source: "test", sourceId: "role", url: "https://example.com/role",
      title: "TypeScript Engineer", titleNorm: "typescript engineer", description: "Build TypeScript services.",
      firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "role",
    }).run();
    const original = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["typescript"], titleAliases: [], skillAliases: {}, preferences: {},
    }, db, now);
    retrieveMatches(original, { database: db, now, limit: 10 });
    assert.equal(listRankedMatches(original, { database: db }).length, 1);

    const changed = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["typescript"], titleAliases: ["software engineer"], skillAliases: {}, preferences: {},
    }, db, new Date(now.valueOf() + 1_000));
    assert.equal(listRankedMatches(changed, { database: db }).length, 0);

    retrieveMatches(changed, { database: db, now, limit: 10 });
    assert.equal(listRankedMatches(changed, { database: db }).length, 1);
  } finally {
    sqlite.close();
  }
});

test("FTS5 indexes stripped job text and BM25 gives title matches precedence", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    const [titleMatch, bodyMatch] = db.insert(jobs).values([
      {
        companyId: company.id, source: "test", sourceId: "title-match", url: "https://example.com/title",
        title: "TypeScript Engineer", titleNorm: "typescript engineer",
        description: "Build reliable services.", firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "title-match",
      },
      {
        companyId: company.id, source: "test", sourceId: "body-match", url: "https://example.com/body",
        title: "Platform Engineer", titleNorm: "platform engineer",
        description: "Build reliable TypeScript services.\n\nEqual opportunity employer.", firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "body-match",
      },
    ]).returning().all();
    const profile = saveProfile({
      resumeJson: { experience: [], education: [], projects: [] },
      skills: ["typescript"], titleAliases: [], skillAliases: {}, preferences: {},
    }, db, now);

    const ranked = retrieveMatches(profile, { database: db, now, limit: 10 });
    assert.deepEqual(ranked.map((match) => match.job.id), [titleMatch!.id, bodyMatch!.id]);
    assert.ok(ranked[0]!.lexicalScore > ranked[1]!.lexicalScore);

    const ftsDefinition = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'jobs_fts'").get() as { sql: string } | undefined;
    assert.match(ftsDefinition?.sql ?? "", /fts5/i);
    const indexed = sqlite.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ? ORDER BY bm25(jobs_fts, 8.0, 1.0)").all("typescript") as Array<{ rowid: number }>;
    assert.deepEqual(indexed.map((row) => row.rowid), [titleMatch!.id, bodyMatch!.id]);
    const boilerplateHits = sqlite.prepare("SELECT rowid FROM jobs_fts WHERE jobs_fts MATCH ?").all("opportunity") as Array<{ rowid: number }>;
    assert.deepEqual(boilerplateHits, []);
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
    let prompt = "";
    const result = await rerankMatches({
      profile,
      matches: ranked,
      database: db,
      providers: [fakeProvider(`{"results":[{"job_id":${job.id},"score":88,"reasoning":"Strong TypeScript overlap","gaps":["No salary listed"],"strengths":["TypeScript"],"flags":[],"extracted":{"seniority":"mid","salary_min":100000,"salary_max":140000,"currency":"USD","remote_type":"remote","stack":["typescript"]}}]}`, (value) => { prompt = value; })],
    });
    assert.deepEqual(result, { scored: 1, failed: 0 });
    assert.match(prompt, /"results"/);
    assert.match(prompt, /"reasoning"/);
    assert.match(prompt, /"extracted"/);
    const stored = db.select().from(matches).get()!;
    assert.equal(stored.llmScore, 88);
    assert.equal(stored.reasoning, "Strong TypeScript overlap");
    assert.equal(db.select().from(jobs).get()?.salaryMin, 100000);
    assert.equal(db.select().from(jobs).get()?.remoteType, "remote");
    retrieveMatches(profile, { database: db, now });
    assert.equal(db.select().from(matches).get()?.llmScore, 88);
    recordTriage({ jobId: job.id, profileId: profile.id, decision: "skip", database: db, now: new Date(now.valueOf() + 1_000) });
    assert.equal(retrieveMatches(profile, { database: db, now }).length, 0);
  } finally {
    sqlite.close();
  }
});

test("LLM rerank rejects a partial batch response", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({
      name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now,
    }).returning().get()!;
    db.insert(jobs).values([
      {
        companyId: company.id, source: "test", sourceId: "one", url: "https://example.com/one",
        title: "Product Engineer", titleNorm: "product engineer", description: "Build product software.",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "one",
      },
      {
        companyId: company.id, source: "test", sourceId: "two", url: "https://example.com/two",
        title: "Frontend Engineer", titleNorm: "frontend engineer", description: "Build product software.",
        firstSeenAt: now, lastSeenAt: now, postedAt: now, contentHash: "two",
      },
    ]).run();
    const profile = ensureActiveProfile(db, now);
    const ranked = retrieveMatches(profile, { database: db, now, limit: 2 });
    const response = JSON.stringify({ results: [{
      job_id: ranked[0]!.job.id,
      score: 88,
      reasoning: "Strong fit.",
      gaps: [],
      strengths: ["Product work"],
      flags: [],
      extracted: {
        salary_min: null,
        salary_max: null,
        currency: null,
        seniority: null,
        remote_type: null,
        stack: [],
      },
    }] });
    const result = await rerankMatches({
      profile,
      matches: ranked,
      database: db,
      batchSize: 2,
      providers: [fakeProvider(response)],
    });
    assert.deepEqual(result, { scored: 0, failed: 2 });
    assert.deepEqual(db.select().from(matches).all().map((match) => match.llmScore), [null, null]);
  } finally {
    sqlite.close();
  }
});
