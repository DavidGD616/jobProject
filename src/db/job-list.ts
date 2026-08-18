import { and, count, desc, eq, gte, isNull, like, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import {
  lexicalScore,
  matchesProfileTerm,
  profileTerms,
  tokenize,
} from "@/matching/text";

import { db } from "./client";
import { companies, jobs, triage } from "./schema";
import type { Job, Profile } from "./schema";
import type { JobHuntDatabase } from "./types";

export const dateWindows = ["all", "24h", "7d", "30d"] as const;
export type DateWindow = (typeof dateWindows)[number];

export const jobListScopes = ["profile", "all"] as const;
export type JobListScope = (typeof jobListScopes)[number];

/**
 * Explore is intentionally a broad candidate workspace, not a final ranking.
 * Scan the strongest lexical hits, then retain a bounded, diverse-enough pool
 * for browsing before the Matches workflow makes its smaller shortlist.
 */
const PROFILE_CANDIDATE_SCAN_LIMIT = 1_500;
const PROFILE_CANDIDATE_LIMIT = 300;
const VISIBLE_JOB_LIMIT = 100;

export interface JobListFilters {
  company: string | null;
  title: string | null;
  dateWindow: DateWindow;
  scope: JobListScope;
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

export interface ListOpenJobsOptions {
  now?: Date;
  database?: JobHuntDatabase;
  profile?: Profile | null;
}

type ProfileCandidate = {
  job: Job;
  company: typeof companies.$inferSelect;
  bm25: number;
};

function textFilter(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed.slice(0, 160) : null;
}

export function parseJobListFilters(input: {
  company?: string | string[];
  title?: string | string[];
  date?: string | string[];
  scope?: string | string[];
}): JobListFilters {
  const date = textFilter(input.date);
  const scope = textFilter(input.scope);
  return {
    company: textFilter(input.company),
    title: textFilter(input.title),
    dateWindow: date && dateWindows.includes(date as DateWindow)
      ? (date as DateWindow)
      : "all",
    scope: scope === "all" ? "all" : "profile",
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

function whereFor(filters: JobListFilters, now: Date): SQL | undefined {
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

function toJobListItem(row: {
  job: Job;
  company: typeof companies.$inferSelect;
}): JobListItem {
  return {
    id: row.job.id,
    title: row.job.title,
    url: row.job.url,
    companyName: row.company.name,
    companySlug: row.company.slug,
    location: row.job.location,
    remoteType: row.job.remoteType,
    salaryMin: row.job.salaryMin,
    salaryMax: row.job.salaryMax,
    salaryPeriod: row.job.salaryPeriod,
    currency: row.job.currency,
    seniority: row.job.seniority,
    postedAt: row.job.postedAt,
    firstSeenAt: row.job.firstSeenAt,
  };
}

function ftsPhrase(term: string): string | null {
  const tokens = tokenize(term);
  if (tokens.length === 0) return null;
  return `"${tokens.join(" ").replaceAll('"', '""')}"`;
}

function ftsMatchQuery(profile: Profile): {
  terms: Array<{ term: string; weight: number }>;
  matchQuery: string | null;
} {
  const terms = profileTerms({
    skills: profile.skills,
    titleAliases: profile.titleAliases,
    skillAliases: profile.skillAliases,
    queryTerms: profile.queryTerms,
  });
  const phrases = [...new Set(terms.flatMap((item) => {
    const phrase = ftsPhrase(item.term);
    return phrase ? [phrase] : [];
  }))];
  return { terms, matchQuery: phrases.length > 0 ? phrases.join(" OR ") : null };
}

function latestTriage(
  database: JobHuntDatabase,
  profileId: number,
): Map<number, string> {
  const decisions = new Map<number, { id: number; decision: string }>();
  for (const row of database.select().from(triage).where(eq(triage.profileId, profileId)).all()) {
    const current = decisions.get(row.jobId);
    if (!current || row.id > current.id) {
      decisions.set(row.jobId, { id: row.id, decision: row.decision });
    }
  }
  return new Map([...decisions].map(([jobId, row]) => [jobId, row.decision]));
}

function normalizeBm25(rows: readonly ProfileCandidate[]): Map<number, number> {
  if (rows.length === 0) return new Map();
  const relevanceByJob = new Map(rows.map((row) => [row.job.id, Math.max(0, -row.bm25)]));
  const values = [...relevanceByJob.values()];
  const highest = Math.max(...values);
  const lowest = Math.min(...values);
  if (highest === lowest) {
    return new Map([...relevanceByJob.keys()].map((id) => [id, 1]));
  }
  return new Map(
    [...relevanceByJob].map(([jobId, relevance]) => [
      jobId,
      (relevance - lowest) / (highest - lowest),
    ]),
  );
}

function matchesListFilters(
  row: ProfileCandidate,
  filters: JobListFilters,
  now: Date,
): boolean {
  if (filters.company && row.company.slug !== filters.company) return false;
  if (filters.title && !row.job.title.toLowerCase().includes(filters.title.toLowerCase())) return false;
  const cutoff = cutoffFor(filters.dateWindow, now);
  return !cutoff || (row.job.postedAt !== null && row.job.postedAt >= cutoff);
}

function isExcluded(job: Job, profile: Profile): boolean {
  const exclusions = profile.preferences.exclusions;
  if (!exclusions || exclusions.length === 0) return false;
  const text = `${job.title}\n${job.description}`.toLowerCase();
  return exclusions.some((term) => text.includes(term.toLowerCase()));
}

function meetsSalaryFloor(job: Job, profile: Profile): boolean {
  const minimum = profile.preferences.minSalary;
  return minimum === undefined || job.salaryMax === null || job.salaryMax >= minimum;
}

function locationAffinity(job: Job, profile: Profile): number {
  const preferences = profile.preferences;
  const allowsRemote = preferences.remoteTypes?.includes("remote") ?? false;
  if (job.remoteType === "remote" && allowsRemote) return 1;
  if (!job.location && (!job.remoteType || job.remoteType === "unknown")) return 0.5;
  const location = job.location?.toLowerCase() ?? "";
  const hasSavedLocation = preferences.locations?.some((value) => {
    const target = value.trim().toLowerCase();
    return target !== "remote" && location.includes(target);
  }) ?? false;
  if (hasSavedLocation) return 1;
  if (
    preferences.remoteTypes?.length === 0
    || (job.remoteType !== null
      && job.remoteType !== "unknown"
      && preferences.remoteTypes?.includes(job.remoteType as "remote" | "hybrid" | "onsite"))
  ) {
    return 0.5;
  }
  return 0.15;
}

function targetCompanyAffinity(
  company: typeof companies.$inferSelect,
  profile: Profile,
): number {
  const targets = profile.preferences.targetCompanies;
  if (!targets || targets.length === 0) return 0.5;
  const text = `${company.name} ${company.slug}`.toLowerCase();
  return targets.some((value) => text.includes(value.toLowerCase())) ? 1 : 0.5;
}

function listProfileGuidedJobs(
  filters: JobListFilters,
  profile: Profile,
  now: Date,
  database: JobHuntDatabase,
): JobListData {
  const { terms, matchQuery } = ftsMatchQuery(profile);
  if (!matchQuery) {
    return { filters, jobs: [], total: 0, openCompanies: 0, companies: [] };
  }
  const bm25 = sql<number>`bm25(jobs_fts, 8.0, 1.0)`.as("bm25_score");
  const filterWhere = whereFor(filters, now);
  const rows = database.select({ job: jobs, company: companies, bm25 })
    .from(jobs)
    .innerJoin(sql`jobs_fts`, sql`jobs_fts.rowid = ${jobs.id}`)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(
      filterWhere,
      sql`jobs_fts MATCH ${matchQuery}`,
    ))
    .orderBy(sql`bm25(jobs_fts, 8.0, 1.0)`, jobs.id)
    .limit(PROFILE_CANDIDATE_SCAN_LIMIT)
    .all();
  const bm25Scores = normalizeBm25(rows);
  const decisions = latestTriage(database, profile.id);
  const candidates = rows
    .filter((row) => matchesListFilters(row, filters, now))
    .filter(({ job }) => !isExcluded(job, profile) && meetsSalaryFloor(job, profile))
    .filter(({ job }) => !["skip", "block_company"].includes(decisions.get(job.id) ?? ""))
    .map((row) => {
      const exact = lexicalScore({
        title: row.job.title,
        description: row.job.descriptionFts ?? row.job.description,
        stack: row.job.stack,
        terms,
      });
      const titleAliasHit = profile.titleAliases.some((alias) =>
        matchesProfileTerm(row.job.title.toLowerCase(), alias),
      ) ? 1 : 0;
      const score = (bm25Scores.get(row.job.id) ?? 0) * 0.45
        + exact * 0.2
        + titleAliasHit * 0.15
        + locationAffinity(row.job, profile) * 0.1
        + targetCompanyAffinity(row.company, profile) * 0.1;
      return { ...row, score };
    })
    .sort((left, right) => right.score - left.score || right.job.id - left.job.id)
    .slice(0, PROFILE_CANDIDATE_LIMIT);
  const companiesForFilter = [...new Map(
    candidates.map(({ company }) => [company.slug, { slug: company.slug, name: company.name }]),
  ).values()].sort((left, right) => left.name.localeCompare(right.name));

  return {
    filters,
    jobs: candidates.slice(0, VISIBLE_JOB_LIMIT).map(toJobListItem),
    total: candidates.length,
    openCompanies: companiesForFilter.length,
    companies: companiesForFilter,
  };
}

function listAllOpenJobs(
  filters: JobListFilters,
  now: Date,
  database: JobHuntDatabase,
): JobListData {
  const where = whereFor(filters, now);
  const rows = database.select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(where)
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`), desc(jobs.id))
    .limit(VISIBLE_JOB_LIMIT)
    .all();
  const total = database.select({ value: count(jobs.id) })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(where)
    .get()?.value ?? 0;
  const companiesForFilter = database.select({ slug: companies.slug, name: companies.name })
    .from(companies)
    .where(and(eq(companies.active, true), eq(companies.blocked, false)))
    .orderBy(companies.name)
    .all();
  return {
    filters,
    jobs: rows.map(toJobListItem),
    total,
    openCompanies: companiesForFilter.length,
    companies: companiesForFilter,
  };
}

/**
 * Read the local official-job ledger. Profile scope is the default: it keeps
 * a broad, scored candidate pool visible without corrupting source snapshots
 * or invoking an LLM from a request path. `scope=all` is an explicit escape
 * hatch for inspecting the underlying official-board inventory.
 */
export function listOpenJobs(
  filters: JobListFilters,
  options: ListOpenJobsOptions = {},
): JobListData {
  const now = options.now ?? new Date();
  const database = options.database ?? db;
  if (filters.scope === "profile") {
    return options.profile
      ? listProfileGuidedJobs(filters, options.profile, now, database)
      : { filters, jobs: [], total: 0, openCompanies: 0, companies: [] };
  }
  return listAllOpenJobs(filters, now, database);
}
