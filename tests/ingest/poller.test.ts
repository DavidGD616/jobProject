import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { companies, jobs, sourcePolls } from "@/db/schema";
import { runSourcePolls } from "@/ingest/poller";
import type { PollableSource } from "@/ingest/poller";
import type { NormalizedPosting, SourceFetchResult } from "@/sources";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { companies, jobs, sourcePolls } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

async function insertCompany(
  db: ReturnType<typeof createTestDatabase>["db"],
  input: { name: string; slug: string; blocked?: boolean },
) {
  const at = new Date("2026-08-17T00:00:00.000Z");
  const rows = await db
    .insert(companies)
    .values({
      name: input.name,
      slug: input.slug,
      atsType: "test-source",
      atsToken: input.slug,
      careersUrl: `https://example.com/${input.slug}`,
      blocked: input.blocked ?? false,
      discoveredVia: "test",
      discoveredAt: at,
      createdAt: at,
    })
    .returning();
  return rows[0]!;
}

const posting: NormalizedPosting = {
  url: "https://example.com/jobs/1",
  title: "Software Engineer",
  titleNorm: "software engineer",
  description: "Build durable software.",
  location: "Remote",
  remoteType: "remote",
  postedAt: null,
};

type FakeRaw = { id: string; posting: NormalizedPosting };

function fakeSource(
  results: Array<SourceFetchResult<FakeRaw> | Error>,
  calls: Array<{ etag: string | null | undefined; companyId: number }>,
): PollableSource {
  return {
    id: "test-source",
    cadenceMs: 6 * 60 * 60 * 1_000,
    userAgent: "test-agent",
    adapter: {
      async fetch(config) {
        calls.push({ etag: config.etag, companyId: config.company.id });
        const next = results.shift();
        if (!next) throw new Error("missing fake source result");
        if (next instanceof Error) throw next;
        return next;
      },
      normalize(raw) {
        return (raw as FakeRaw).posting;
      },
      sourceId(raw) {
        return (raw as FakeRaw).id;
      },
    },
  };
}

test("source poller persists ETags and skips ingest/staleness work on a 304", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const company = await insertCompany(db, { name: "Acme", slug: "acme" });
    const calls: Array<{ etag: string | null | undefined; companyId: number }> = [];
    const source = fakeSource(
      [
        { kind: "fetched", postings: [{ id: "one", posting }], etag: "etag-1" },
        { kind: "not_modified", etag: "etag-1" },
      ],
      calls,
    );
    let now = new Date("2026-08-17T00:00:00.000Z");

    const first = await runSourcePolls(db, {
      sources: [source],
      now: () => now,
    });
    assert.equal(first.fetched, 1);
    assert.equal(first.inserted, 1);
    assert.deepEqual(calls, [{ companyId: company.id, etag: null }]);

    now = new Date("2026-08-17T06:00:00.000Z");
    const second = await runSourcePolls(db, {
      sources: [source],
      force: true,
      now: () => now,
    });
    assert.equal(second.notModified, 1);
    assert.equal(second.updated, 0);
    assert.equal(second.closed, 0);
    assert.deepEqual(calls[1], { companyId: company.id, etag: "etag-1" });

    const storedJobs = await db.select().from(jobs);
    assert.equal(storedJobs.length, 1);
    assert.equal(storedJobs[0]!.closedAt, null);
    const polls = await db.select().from(sourcePolls);
    assert.equal(polls[0]!.lastStatus, "not_modified");
    assert.equal(polls[0]!.consecutiveFailures, 0);
  } finally {
    sqlite.close();
  }
});

test("two successful empty snapshots close a job", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    await insertCompany(db, { name: "Acme", slug: "acme" });
    const calls: Array<{ etag: string | null | undefined; companyId: number }> = [];
    const source = fakeSource(
      [
        { kind: "fetched", postings: [{ id: "one", posting }], etag: null },
        { kind: "fetched", postings: [], etag: null },
        { kind: "fetched", postings: [], etag: null },
      ],
      calls,
    );
    let now = new Date("2026-08-17T00:00:00.000Z");
    await runSourcePolls(db, {
      sources: [source],
      sourceIds: ["test-source"],
      now: () => now,
    });

    now = new Date("2026-08-17T06:00:00.000Z");
    const firstEmpty = await runSourcePolls(db, {
      sources: [source],
      force: true,
      now: () => now,
    });
    assert.equal(firstEmpty.firstMissing, 1);
    assert.equal(firstEmpty.closed, 0);

    now = new Date("2026-08-17T12:00:00.000Z");
    const secondEmpty = await runSourcePolls(db, {
      sources: [source],
      force: true,
      now: () => now,
    });
    assert.equal(secondEmpty.closed, 1);
  } finally {
    sqlite.close();
  }
});

test("a 404 inactivates only its board", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const company = await insertCompany(db, { name: "Gone", slug: "gone" });
    const calls: Array<{ etag: string | null | undefined; companyId: number }> = [];
    const notFound = Object.assign(new Error("not found"), { status: 404 });
    const source = fakeSource([notFound], calls);

    const result = await runSourcePolls(db, {
      sources: [source],
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    });
    assert.equal(result.deactivated, 1);
    const rows = await db
      .select({ active: companies.active })
      .from(companies)
      .where(eq(companies.id, company.id));
    assert.equal(rows[0]!.active, false);
  } finally {
    sqlite.close();
  }
});

test("an access-denied response pauses the source before another board is dispatched", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    await insertCompany(db, { name: "First", slug: "first" });
    await insertCompany(db, { name: "Second", slug: "second" });
    const calls: Array<{ etag: string | null | undefined; companyId: number }> = [];
    const denied = Object.assign(new Error("forbidden"), { status: 403 });
    const source = fakeSource([denied], calls);

    const result = await runSourcePolls(db, {
      sources: [source],
      now: () => new Date("2026-08-17T00:00:00.000Z"),
    });
    assert.equal(result.attempted, 1);
    assert.deepEqual(result.pausedSources, ["test-source"]);
    assert.equal(calls.length, 1);
  } finally {
    sqlite.close();
  }
});
