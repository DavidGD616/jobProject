import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";
import { recordExtractionResult, saveExtractionRule, shouldRegenerateRule } from "@/db";
import { extractCareerPagePostings, normalizeCareerPagePosting } from "@/sources";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("career page selectors parse rendered HTML and normalize postings", () => {
  const html = '<ul><li class="job"><a class="title" href="/jobs/1">Senior Engineer</a><span class="location">Remote</span><p class="description">Build systems.</p></li></ul>';
  const postings = extractCareerPagePostings(html, { item: "li.job", title: "a.title", url: "a.title", location: "span.location", description: "p.description" }, "https://example.com/careers");
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.url, "https://example.com/jobs/1");
  assert.equal(normalizeCareerPagePosting(postings[0]!).titleNorm, "senior engineer");
});

test("career extraction rules reset on success and flag repeated zero-row runs", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const rule = saveExtractionRule({ companyId: company.id, domain: "example.com", domFingerprint: "a", selectors: { item: "li.job", title: "a.title", url: "a.title" }, database: db, now });
    const first = recordExtractionResult({ ruleId: rule.id, count: 0, database: db, now });
    const second = recordExtractionResult({ ruleId: rule.id, count: 0, database: db, now });
    assert.equal(shouldRegenerateRule(second), true);
    assert.equal(recordExtractionResult({ ruleId: rule.id, count: 1, database: db, now }).failCount, 0);
    assert.equal(first.failCount, 1);
  } finally {
    sqlite.close();
  }
});
