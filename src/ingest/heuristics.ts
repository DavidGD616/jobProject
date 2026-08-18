import type { NormalizedPosting } from "@/sources";

import { normalizeRemoteType } from "../sources/normalize";

type SalaryPeriod = "year" | "month" | "hour";

export interface HeuristicPosting extends NormalizedPosting {
  extractionTier: "none" | "heuristic";
}

const seniorityPatterns: readonly [RegExp, string][] = [
  [/\b(?:intern(?:ship)?|co-?op)\b/i, "intern"],
  [/\b(?:junior|jr\.?)\b/i, "junior"],
  [/\b(?:senior|sr\.?)\b/i, "senior"],
  [/\b(?:staff|principal|distinguished)\b/i, "staff"],
  [/\b(?:lead|manager|director|head of)\b/i, "lead"],
  [/\b(?:mid(?:-level)?|intermediate)\b/i, "mid"],
];

const salaryRange = new RegExp(
  String.raw`(?:(USD|CAD|AUD|GBP|EUR)\s*)?(\$|£|€)?\s*(\d{2,3}\s*[kK]|\d{2,3}(?:[,.]\d{3})?)\s*(?:-|–|—|to)\s*(?:(USD|CAD|AUD|GBP|EUR)\s*)?(\$|£|€)?\s*(\d{2,3}\s*[kK]|\d{2,3}(?:[,.]\d{3})?)\s*(?:\/?\s*(year|yr|annum|month|mo|hour|hr))?`,
  "i",
);

/** Remove common benefit/EEO boilerplate before FTS5 indexes a posting. */
export function stripBoilerplate(input: string): string {
  const chunks = input.split(/\n{2,}/).filter((chunk) => {
    return !/(equal opportunity|benefits package|what we offer|perks and benefits|privacy notice|accommodations statement)/i.test(chunk);
  });
  return chunks.join("\n\n").trim().slice(0, 80_000);
}

function salaryNumber(value: string): number | null {
  const normalized = value.replace(/[,$\s]/g, "");
  const multiplier = /k$/i.test(normalized) ? 1_000 : 1;
  const numeric = Number.parseFloat(normalized.replace(/k$/i, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * multiplier);
}

function currencyFromMatch(match: RegExpMatchArray): string | null {
  const explicit = match[1] ?? match[4];
  if (explicit) return explicit.toUpperCase();

  const symbol = match[2] ?? match[5];
  if (symbol === "£") return "GBP";
  if (symbol === "€") return "EUR";
  // A bare dollar sign is intentionally ambiguous: do not silently assign USD.
  return null;
}

function periodFromMatch(match: RegExpMatchArray): SalaryPeriod | null {
  const value = match[7]?.toLocaleLowerCase();
  if (!value) return null;
  if (["year", "yr", "annum"].includes(value)) return "year";
  if (["month", "mo"].includes(value)) return "month";
  return "hour";
}

function salaryFromText(text: string): {
  min: number;
  max: number;
  currency: string | null;
  period: SalaryPeriod | null;
} | null {
  const match = text.match(salaryRange);
  if (!match) return null;

  const min = salaryNumber(match[3]!);
  const max = salaryNumber(match[6]!);
  if (min === null || max === null || min > max) return null;

  return {
    min,
    max,
    currency: currencyFromMatch(match),
    period: periodFromMatch(match),
  };
}

function seniorityFromTitle(title: string): string | null {
  return seniorityPatterns.find(([pattern]) => pattern.test(title))?.[1] ?? null;
}

function remoteTypeFromText(
  posting: NormalizedPosting,
): NormalizedPosting["remoteType"] {
  if (posting.remoteType && posting.remoteType !== "unknown") {
    return posting.remoteType;
  }

  const source = `${posting.title}\n${posting.location ?? ""}\n${posting.description}`;
  if (/\bhybrid\b/i.test(source)) return "hybrid";
  if (/\b(?:remote|work from home|distributed)\b/i.test(source)) return "remote";
  return normalizeRemoteType(posting.location);
}

/**
 * Fill only absent fields from cheap, deterministic signals. API-provided
 * values remain authoritative, and no LLM work is performed at ingest time.
 */
export function applyIngestHeuristics(
  posting: NormalizedPosting,
): HeuristicPosting {
  const salary = salaryFromText(`${posting.title}\n${posting.description}`);
  const seniority = posting.seniority ?? seniorityFromTitle(posting.title);
  const remoteType = remoteTypeFromText(posting);
  const changed =
    seniority !== posting.seniority ||
    remoteType !== posting.remoteType ||
    (posting.salaryMin === null || posting.salaryMin === undefined) &&
      salary !== null;

  return {
    ...posting,
    seniority,
    remoteType,
    salaryMin: posting.salaryMin ?? salary?.min ?? null,
    salaryMax: posting.salaryMax ?? salary?.max ?? null,
    salaryPeriod: posting.salaryPeriod ?? salary?.period ?? null,
    currency: posting.currency ?? salary?.currency ?? null,
    extractionTier: changed ? "heuristic" : "none",
  };
}
