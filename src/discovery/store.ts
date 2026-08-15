import { eq } from "drizzle-orm";

import { companies } from "../db/schema";
import type { Company } from "../db/schema";
import type { VerifiedCompany } from "./_contract";

type DiscoveryDatabase = typeof import("../db").db;

export interface DiscoveryUpsertResult {
  inserted: number;
  updated: number;
  companies: Company[];
}

function uniqueBySlug(companiesToStore: readonly VerifiedCompany[]): VerifiedCompany[] {
  const seen = new Set<string>();
  const unique: VerifiedCompany[] = [];
  for (const company of companiesToStore) {
    if (seen.has(company.slug)) continue;
    seen.add(company.slug);
    unique.push(company);
  }
  return unique;
}

/** Upsert verified boards without changing blocked state or original provenance. */
export function upsertVerifiedCompanies(
  database: DiscoveryDatabase,
  verifiedCompanies: readonly VerifiedCompany[],
  observedAt: Date,
): DiscoveryUpsertResult {
  return database.transaction((tx) => {
    let inserted = 0;
    let updated = 0;
    const stored: Company[] = [];

    for (const company of uniqueBySlug(verifiedCompanies)) {
      const existing = tx
        .select()
        .from(companies)
        .where(eq(companies.slug, company.slug))
        .get();

      if (existing) {
        tx
          .update(companies)
          .set({
            name: company.name,
            atsType: company.atsType,
            atsToken: company.atsToken,
            careersUrl: company.careersUrl,
            lastProbeAt: observedAt,
            active: true,
          })
          .where(eq(companies.id, existing.id))
          .run();
        updated += 1;
      } else {
        tx
          .insert(companies)
          .values({
            name: company.name,
            slug: company.slug,
            atsType: company.atsType,
            atsToken: company.atsToken,
            careersUrl: company.careersUrl,
            discoveredVia: company.discoveredVia,
            discoveredAt: observedAt,
            lastProbeAt: observedAt,
            active: true,
            createdAt: observedAt,
          })
          .run();
        inserted += 1;
      }

      const storedCompany = tx
        .select()
        .from(companies)
        .where(eq(companies.slug, company.slug))
        .get();
      if (storedCompany) stored.push(storedCompany);
    }

    return { inserted, updated, companies: stored };
  });
}
