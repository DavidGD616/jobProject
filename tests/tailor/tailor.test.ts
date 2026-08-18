import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } from "@/db/schema";
import { saveProfile } from "@/matching";
import { createTailoredVariant, resumeToHtml } from "@/tailor";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("tailoring only reorders stored facts and renders a local export", async () => {
  const { db, sqlite } = createTestDatabase();
  const exportDirectory = await mkdtemp(resolve(tmpdir(), "job-hunt-tailor-test-"));
  const previousExportDirectory = process.env.EXPORT_DIR;
  process.env.EXPORT_DIR = exportDirectory;
  try {
    const now = new Date("2026-08-17T12:00:00.000Z");
    const company = db.insert(companies).values({ name: "Acme", slug: "acme", discoveredVia: "test", discoveredAt: now, createdAt: now }).returning().get()!;
    const job = db.insert(jobs).values({ companyId: company.id, source: "test", sourceId: "1", url: "https://example.com/1", title: "TypeScript Engineer", titleNorm: "typescript engineer", description: "Build TypeScript services.", firstSeenAt: now, lastSeenAt: now, contentHash: "1" }).returning().get()!;
    const profile = saveProfile({
      resumeJson: { name: "Taylor", experience: [{ company: "Old Co", title: "Engineer", bullets: ["Led a hiring panel", "Built TypeScript services"] }], education: [], projects: [] },
      skills: ["typescript"], titleAliases: [], skillAliases: {}, preferences: {},
    }, db, now);
    const variant = await createTailoredVariant({ jobId: job.id, profile, database: db, allowLlm: false, now });
    assert.equal(variant.llmUsed, false);
    assert.ok(variant.htmlPath.endsWith(".html"));
    assert.ok(variant.pdfPath === null || variant.pdfPath.endsWith(".pdf"));
    const html = await readFile(variant.htmlPath, "utf8");
    assert.match(html, /TypeScript services/);
    assert.doesNotMatch(html, /Evidence from your background/);
    assert.match(resumeToHtml(profile.resumeJson), /Taylor/);
    const richerHtml = resumeToHtml({
      ...profile.resumeJson,
      portfolioUrl: "https://example.com/portfolio",
      skills: ["TypeScript", "React"],
      interests: ["Running"],
    });
    assert.match(richerHtml, /https:\/\/example.com\/portfolio/);
    assert.match(richerHtml, /Skills &amp; technologies/);
    assert.match(richerHtml, /Running/);
  } finally {
    if (previousExportDirectory === undefined) delete process.env.EXPORT_DIR;
    else process.env.EXPORT_DIR = previousExportDirectory;
    sqlite.close();
    await rm(exportDirectory, { recursive: true, force: true });
  }
});
