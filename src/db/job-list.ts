import { and, count, desc, eq, gte, isNull, like, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { companies, jobs } from "./schema";
import { db } from "./client";
import type { JobHuntDatabase } from "./types";

export const dateWindows = ["all", "24h", "7d", "30d"] as const;
export type DateWindow = (typeof dateWindows)[number];

export interface JobListFilters {
  company: string | null;
  title: string | null;
  dateWindow: DateWindow;
}

export interface JobListItem {
  id: number;
  title: string;
  url: string;
  companyName: string;
  companySlug: string;
  location: string | null;
  remoteType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryPeriod: string | null;
  currency: string | null;
  seniority: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
}

export interface JobListData {
  filters: JobListFilters;
  jobs: JobListItem[];
  total: number;
  openCompanies: number;
  companies: Array<{ slug: string; name: string }>;
}

function textFilter(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed.slice(0, 160) : null;
}

export function parseJobListFilters(input: {
  company?: string | string[];
  title?: string | string[];
  date?: string | string[];
}): JobListFilters {
  const date = textFilter(input.date);
  return {
    company: textFilter(input.company),
    title: textFilter(input.title),
    dateWindow: date && dateWindows.includes(date as DateWindow)
      ? (date as DateWindow)
      : "all",
  };
}

function cutoffFor(window: DateWindow, now: Date): Date | null {
  const durationMs = {
    "24h": 24 * 60 * 60 * 1_000,
    "7d": 7 * 24 * 60 * 60 * 1_000,
    "30d": 30 * 24 * 60 * 60 * 1_000,
  } as const;
  const duration = durationMs[window as keyof typeof durationMs];
  return duration ? new Date(now.valueOf() - duration) : null;
}

function whereFor(
  filters: JobListFilters,
  now: Date,
): SQL | undefined {
  const conditions: SQL[] = [
    isNull(jobs.closedAt),
    isNull(jobs.canonicalId),
    eq(companies.active, true),
    eq(companies.blocked, false),
  ];
  if (filters.company) conditions.push(eq(companies.slug, filters.company));
  if (filters.title) conditions.push(like(jobs.title, `%${filters.title}%`));
  const cutoff = cutoffFor(filters.dateWindow, now);
  if (cutoff) conditions.push(gte(jobs.postedAt, cutoff));
  return and(...conditions);
}

/** Read-only query boundary used by the local Phase 1 review page. */
export function listOpenJobs(
  filters: JobListFilters,
  now = new Date(),
  database: JobHuntDatabase = db,
): JobListData {
  const where = whereFor(filters, now);
  const jobsForReview = database
    .select({
      id: jobs.id,
      title: jobs.title,
      url: jobs.url,
      companyName: companies.name,
      companySlug: companies.slug,
      location: jobs.location,
      remoteType: jobs.remoteType,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryPeriod: jobs.salaryPeriod,
      currency: jobs.currency,
      seniority: jobs.seniority,
      postedAt: jobs.postedAt,
      firstSeenAt: jobs.firstSeenAt,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(where)
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`), desc(jobs.id))
    .limit(100)
    .all();
  const total = database
    .select({ value: count(jobs.id) })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(where)
    .get()?.value ?? 0;
  const companiesForFilter = database
    .select({ slug: companies.slug, name: companies.name })
    .from(companies)
    .where(and(eq(companies.active, true), eq(companies.blocked, false)))
    .orderBy(companies.name)
    .all();

  return {
    filters,
    jobs: jobsForReview,
    total,
    openCompanies: companiesForFilter.length,
    companies: companiesForFilter,
  };
}
