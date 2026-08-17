import { z } from "zod";

import type { CandidateCompany } from "./_contract";

const adzunaResponseSchema = z.object({
  results: z.array(z.object({
    company: z.object({ display_name: z.string().optional() }).optional(),
    redirect_url: z.string().url().optional(),
    title: z.string().optional(),
  })).default([]),
});

export interface AdzunaSearchOptions {
  appId: string;
  apiKey: string;
  country?: string;
  query: string;
  page?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function parseAdzunaResponse(input: unknown): CandidateCompany[] {
  const parsed = adzunaResponseSchema.parse(input);
  const candidates: CandidateCompany[] = [];
  const seen = new Set<string>();
  for (const result of parsed.results) {
    const url = result.redirect_url ?? "";
    const company = result.company?.display_name?.trim();
    if (!company || !url || seen.has(company.toLowerCase())) continue;
    seen.add(company.toLowerCase());
    candidates.push({ name: company, discoveredVia: "adzuna", ...extractReverse(url) });
  }
  return candidates;
}

function extractReverse(url: string): Pick<CandidateCompany, "slugHint" | "atsType" | "atsToken"> {
  const greenhouse = url.match(/greenhouse\.io\/([a-z0-9_-]+)/i);
  if (greenhouse) return { slugHint: greenhouse[1], atsType: "greenhouse", atsToken: greenhouse[1] };
  const lever = url.match(/lever\.co\/([a-z0-9_-]+)/i);
  if (lever) return { slugHint: lever[1], atsType: "lever", atsToken: lever[1] };
  const ashby = url.match(/ashbyhq\.com\/([a-z0-9_-]+)/i);
  if (ashby) return { slugHint: ashby[1], atsType: "ashby", atsToken: ashby[1] };
  return {};
}

export async function searchAdzuna(options: AdzunaSearchOptions): Promise<CandidateCompany[]> {
  const country = options.country ?? "us";
  const page = options.page ?? 1;
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}.json`);
  url.searchParams.set("app_id", options.appId);
  url.searchParams.set("app_key", options.apiKey);
  url.searchParams.set("what", options.query);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Adzuna returned HTTP ${response.status}`);
    return parseAdzunaResponse(await response.json());
  } finally {
    clearTimeout(timer);
  }
}
