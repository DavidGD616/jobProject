import { and, eq } from "drizzle-orm";

import { db } from "./client";
import { extractionRules } from "./schema";
import type { CareerPageSelectors, ExtractionRule } from "./schema";
import type { JobHuntDatabase } from "./types";
import { parseCareerPageSelectors } from "@/sources/career-page";

export function getExtractionRule(input: { companyId: number; domain: string; database?: JobHuntDatabase }): ExtractionRule | null {
  const database = input.database ?? db;
  return database.select().from(extractionRules).where(and(eq(extractionRules.companyId, input.companyId), eq(extractionRules.domain, input.domain))).get() ?? null;
}

export function saveExtractionRule(input: {
  companyId: number;
  domain: string;
  domFingerprint: string;
  selectors: CareerPageSelectors;
  generatedBy?: string | null;
  database?: JobHuntDatabase;
  now?: Date;
}): ExtractionRule {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const selectors = parseCareerPageSelectors(input.selectors);
  return database.insert(extractionRules).values({
    companyId: input.companyId,
    domain: input.domain,
    domFingerprint: input.domFingerprint,
    selectors,
    generatedAt: now,
    generatedBy: input.generatedBy ?? "manual",
    lastOkAt: null,
    failCount: 0,
  }).onConflictDoUpdate({
    target: [extractionRules.companyId, extractionRules.domain],
    set: {
      domFingerprint: input.domFingerprint,
      selectors,
      generatedAt: now,
      generatedBy: input.generatedBy ?? "manual",
      lastOkAt: null,
      failCount: 0,
    },
  }).returning().get()!;
}

export function recordExtractionResult(input: { ruleId: number; count: number; database?: JobHuntDatabase; now?: Date }): ExtractionRule {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const rule = database.select().from(extractionRules).where(eq(extractionRules.id, input.ruleId)).get();
  if (!rule) throw new Error(`Extraction rule ${input.ruleId} not found`);
  return database.update(extractionRules).set(input.count > 0 ? { lastOkAt: now, failCount: 0 } : { failCount: rule.failCount + 1 }).where(eq(extractionRules.id, input.ruleId)).returning().get()!;
}

export function shouldRegenerateRule(rule: ExtractionRule, threshold = 2): boolean {
  return rule.failCount >= threshold;
}
