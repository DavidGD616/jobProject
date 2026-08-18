import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "@/db/schema";
import { clearAllTailoredVariants } from "@/tailor/cli";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

test("clear-all removes variants and exports while retaining application history", async () => {
  const { db, sqlite } = createTestDatabase();
  const exportDirectory = await mkdtemp(join(tmpdir(), "job-hunt-clear-all-exports-"));
  const outsideDirectory = await mkdtemp(join(tmpdir(), "job-hunt-clear-all-outside-"));
  try {
    const createdAt = new Date("2026-08-18T12:00:00.000Z");
    const clearedAt = new Date("2026-08-18T12:05:00.000Z");
    const company = db.insert(schema.companies).values({
      name: "Acme",
      slug: "acme",
      discoveredVia: "test",
      discoveredAt: createdAt,
      createdAt,
    }).returning().get()!;
    const job = db.insert(schema.jobs).values({
      companyId: company.id,
      source: "test",
      sourceId: "clear-all-job",
      url: "https://example.com/jobs/clear-all",
      title: "Software Engineer",
      titleNorm: "software engineer",
      description: "Build durable software.",
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      contentHash: "clear-all-job-v1",
    }).returning().get()!;
    const profile = db.insert(schema.profiles).values({
      version: 1,
      resumeJson: { experience: [], education: [], projects: [] },
      skills: [],
      titleAliases: [],
      skillAliases: {},
      queryTerms: {},
      preferences: {},
      updatedAt: createdAt,
    }).returning().get()!;
    const firstVariant = db.insert(schema.resumeVariants).values({
      jobId: job.id,
      resumeJson: { experience: [], education: [], projects: [] },
      coverLetter: "Variant letter.",
      pdfPath: join(exportDirectory, "resume-variant-1.pdf"),
      createdAt,
    }).returning().get()!;
    const outsidePdfPath = join(outsideDirectory, "resume-variant-2.pdf");
    const secondVariant = db.insert(schema.resumeVariants).values({
      jobId: job.id,
      resumeJson: { experience: [], education: [], projects: [] },
      coverLetter: "Another variant letter.",
      pdfPath: outsidePdfPath,
      createdAt: new Date(createdAt.valueOf() + 1_000),
    }).returning().get()!;
    const application = db.insert(schema.applications).values({
      jobId: job.id,
      status: "draft",
      resumeVariantId: firstVariant.id,
      coverLetter: "Saved application copy.",
      createdAt,
      updatedAt: createdAt,
    }).returning().get()!;
    const request = db.insert(schema.tailorRequests).values({
      jobId: job.id,
      status: "completed",
      variantId: secondVariant.id,
      createdAt,
      startedAt: createdAt,
      finishedAt: createdAt,
    }).returning().get()!;
    const run = db.insert(schema.applicationRuns).values({
      applicationId: application.id,
      adapter: "greenhouse",
      status: "ready_for_review",
      fields: { materialSnapshot: { resumeVariantId: firstVariant.id } },
      startedAt: createdAt,
      finishedAt: createdAt,
    }).returning().get()!;

    const htmlPath = join(exportDirectory, `resume-variant-${firstVariant.id}.html`);
    const pdfPath = join(exportDirectory, `resume-variant-${firstVariant.id}.pdf`);
    await writeFile(htmlPath, "resume html", "utf8");
    await writeFile(pdfPath, "resume pdf", "utf8");
    await writeFile(outsidePdfPath, "do not remove", "utf8");

    const result = await clearAllTailoredVariants({ database: db, exportDirectory, now: clearedAt });

    assert.equal(result.variantsCleared, 2);
    assert.deepEqual(result.filesRemoved, [htmlPath, pdfPath]);
    assert.equal(db.select().from(schema.resumeVariants).all().length, 0);
    assert.deepEqual(db.select().from(schema.applications).get(), {
      ...application,
      resumeVariantId: null,
      updatedAt: clearedAt,
    });
    assert.deepEqual(db.select().from(schema.tailorRequests).get(), {
      ...request,
      variantId: null,
    });
    assert.deepEqual(db.select().from(schema.applicationRuns).get(), run);
    assert.deepEqual(db.select().from(schema.profiles).get(), profile);
    assert.deepEqual(db.select().from(schema.jobs).get(), job);
    await assert.rejects(access(htmlPath));
    await assert.rejects(access(pdfPath));
    assert.equal(await readFile(outsidePdfPath, "utf8"), "do not remove");
  } finally {
    sqlite.close();
    await rm(exportDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});
