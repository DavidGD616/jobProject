import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";

import { upsertVerifiedCompanies } from "@/discovery";
import type { VerifiedCompany } from "@/discovery";
import * as schema from "@/db/schema";

function verified(overrides: Partial<VerifiedCompany> = {}): VerifiedCompany {
  return {
    name: "Acme Corp",
    slug: "acme",
    atsType: "greenhouse",
    atsToken: "acme",
    careersUrl: "https://boards.greenhouse.io/acme",
    discoveredVia: "probe",
    jobCount: 3,
    ...overrides,
  };
}

test("upsertVerifiedCompanies inserts boards and preserves existing provenance", () => {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder: resolve("drizzle") });

  try {
    const firstSeen = new Date("2026-08-14T12:00:00.000Z");
    const secondSeen = new Date("2026-08-15T12:00:00.000Z");
    const inserted = upsertVerifiedCompanies(
      database,
      [
        verified(),
        verified({ name: "Duplicate Candidate" }),
      ],
      firstSeen,
    );

    assert.equal(inserted.inserted, 1);
    assert.equal(inserted.updated, 0);
    assert.equal(inserted.companies.length, 1);
    assert.equal(inserted.companies[0]?.discoveredAt?.toISOString(), firstSeen.toISOString());

    database
      .update(schema.companies)
      .set({ blocked: true, active: false })
      .where(eq(schema.companies.slug, "acme"))
      .run();

    const updated = upsertVerifiedCompanies(
      database,
      [
        verified({
          name: "Acme, Inc.",
          atsType: "lever",
          atsToken: "acme-inc",
          slug: "acme",
          careersUrl: "https://jobs.lever.co/acme-inc",
          discoveredVia: "hn_hiring",
        }),
      ],
      secondSeen,
    );

    assert.equal(updated.inserted, 0);
    assert.equal(updated.updated, 1);
    const row = updated.companies[0]!;
    assert.equal(row.name, "Acme, Inc.");
    assert.equal(row.atsType, "lever");
    assert.equal(row.atsToken, "acme-inc");
    assert.equal(row.discoveredVia, "probe");
    assert.equal(row.discoveredAt?.toISOString(), firstSeen.toISOString());
    assert.equal(row.lastProbeAt?.toISOString(), secondSeen.toISOString());
    assert.equal(row.active, true);
    assert.equal(row.blocked, true);
  } finally {
    sqlite.close();
  }
});
