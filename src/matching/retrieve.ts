import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { companies, jobs, matches, triage } from "@/db/schema";
import type { Job, Match, Profile } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

import { profileTerms, lexicalScore, stripBoilerplate } from "./text";

const SENIORITY_ORDER = ["intern", "junior", "mid", "senior", "staff", "lead"];

export interface RankedMatch extends Match {
  job: Job;
  company: { id: number; name: string; slug: string; tier: number };
  triageDecision: string | null;
}

function latestTriage(database: JobHuntDatabase, profileId: number): Map<number, string> {
  const decisions = new Map<number, { id: number; decision: string }>();
  for (const row of database.select().from(triage).where(eq(triage.profileId, profileId)).all()) {
    const current = decisions.get(row.jobId);
    if (!current || row.id > current.id) decisions.set(row.jobId, { id: row.id, decision: row.decision });
  }
  return new Map([...decisions].map(([jobId, row]) => [jobId, row.decision]));
}

function textOf(job: Job): string {
  return `${job.title}\n${job.description}`.toLowerCase();
}

function passesStageOne(job: Job, company: { name: string; slug: string; blocked: boolean }, profile: Profile): boolean {
  const preferences = profile.preferences;
  if (company.blocked || job.closedAt !== null || job.canonicalId !== null) return false;
  const text = textOf(job);
  if (preferences.exclusions?.some((term) => text.includes(term.toLowerCase()))) return false;
  if (
    preferences.minSalary !== undefined &&
    job.salaryMax !== null &&
    job.salaryMax < preferences.minSalary
  ) return false;
  if (
    preferences.remoteTypes &&
    preferences.remoteTypes.length > 0 &&
    job.remoteType &&
    job.remoteType !== "unknown" &&
    !preferences.remoteTypes.includes(job.remoteType as "remote" | "hybrid" | "onsite")
  ) return false;
  if (
    preferences.seniorities &&
    preferences.seniorities.length > 0 &&
    job.seniority &&
    !preferences.seniorities.includes(job.seniority)
  ) return false;
  if (preferences.locations && preferences.locations.length > 0 && job.location) {
    const location = job.location.toLowerCase();
    const locationMatches = preferences.locations.some((value) => location.includes(value.toLowerCase()));
    const remoteAllowed = job.remoteType === "remote" && preferences.remoteTypes?.includes("remote");
    if (!locationMatches && !remoteAllowed) return false;
  }
  if (preferences.targetCompanies && preferences.targetCompanies.length > 0) {
    const companyText = `${company.name} ${company.slug}`.toLowerCase();
    if (!preferences.targetCompanies.some((value) => companyText.includes(value.toLowerCase()))) return false;
  }
  return true;
}

function seniorityScore(job: Job, profile: Profile): number {
  if (!job.seniority || !profile.preferences.seniorities?.length) return 0.55;
  const actual = SENIORITY_ORDER.indexOf(job.seniority);
  if (actual < 0) return 0.45;
  const target = Math.min(
    ...profile.preferences.seniorities.map((value) => Math.max(0, SENIORITY_ORDER.indexOf(value))),
  );
  return Math.max(0, 1 - Math.abs(actual - target) * 0.25);
}

function freshnessScore(job: Job, now: Date): number {
  const date = job.postedAt ?? job.firstSeenAt;
  const ageDays = Math.max(0, (now.valueOf() - date.valueOf()) / 86_400_000);
  return Math.exp(-ageDays / 45);
}

function featureScore(job: Job, company: { tier: number }, profile: Profile, now: Date): number {
  const remote = profile.preferences.remoteTypes?.length
    ? job.remoteType === null || job.remoteType === "unknown"
      ? 0.5
      : profile.preferences.remoteTypes.includes(job.remoteType as "remote" | "hybrid" | "onsite") ? 1 : 0
    : 0.5;
  const salary = profile.preferences.minSalary === undefined || job.salaryMax === null
    ? 0.5
    : Math.max(0, Math.min(1, job.salaryMax / profile.preferences.minSalary - 0.25));
  const tier = Math.max(0, Math.min(1, 1 - (company.tier - 1) / 4));
  return seniorityScore(job, profile) * 0.25 + remote * 0.2 + salary * 0.2 + tier * 0.15 + freshnessScore(job, now) * 0.2;
}

function upsertMatch(database: JobHuntDatabase, input: {
  jobId: number;
  profileId: number;
  profileVersion: number;
  lexical: number;
  feature: number;
  retrieval: number;
  now: Date;
}): void {
  database.insert(matches).values({
    jobId: input.jobId,
    profileId: input.profileId,
    profileVersion: input.profileVersion,
    lexicalScore: input.lexical,
    featureScore: input.feature,
    retrievalScore: input.retrieval,
    llmScore: null,
    learnedScore: null,
    reasoning: null,
    gaps: [],
    strengths: [],
    flags: [],
    provider: null,
    model: null,
    cliVersion: null,
    scoredAt: input.now,
  }).onConflictDoUpdate({
    target: [matches.jobId, matches.profileId],
    set: {
      profileVersion: input.profileVersion,
      lexicalScore: input.lexical,
      featureScore: input.feature,
      retrievalScore: input.retrieval,
      llmScore: null,
      learnedScore: null,
      reasoning: null,
      gaps: [],
      strengths: [],
      flags: [],
      provider: null,
      model: null,
      cliVersion: null,
      scoredAt: input.now,
    },
  }).run();
}

/** Stage 1 + stage 2 retrieval. It is synchronous and safe to run as a worker task. */
export function retrieveMatches(
  profile: Profile,
  options: { limit?: number; now?: Date; database?: JobHuntDatabase } = {},
): RankedMatch[] {
  const database = options.database ?? db;
  const now = options.now ?? new Date();
  const limit = options.limit ?? 60;
  const terms = profileTerms({
    skills: profile.skills,
    titleAliases: profile.titleAliases,
    skillAliases: profile.skillAliases,
    queryTerms: profile.queryTerms,
  });
  const decisions = latestTriage(database, profile.id);
  const rows = database.select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(isNull(jobs.closedAt), eq(companies.active, true)))
    .all();
  const candidates = rows
    .filter(({ job, company }) => passesStageOne(job, company, profile))
    .filter(({ job }) => !["skip", "block_company"].includes(decisions.get(job.id) ?? ""))
    .map(({ job, company }) => {
      const descriptionFts = stripBoilerplate(job.description);
      if (job.descriptionFts !== descriptionFts) {
        database.update(jobs).set({ descriptionFts }).where(eq(jobs.id, job.id)).run();
        job = { ...job, descriptionFts };
      }
      const lexical = lexicalScore({
        title: job.title,
        description: descriptionFts,
        stack: job.stack,
        terms,
      });
      const feature = featureScore(job, company, profile, now);
      const retrieval = lexical * 0.6 + feature * 0.4;
      return { job, company, lexical, feature, retrieval };
    })
    .sort((left, right) => right.retrieval - left.retrieval || right.job.id - left.job.id)
    .slice(0, limit);

  for (const candidate of candidates) {
    upsertMatch(database, {
      jobId: candidate.job.id,
      profileId: profile.id,
      profileVersion: profile.version,
      lexical: candidate.lexical,
      feature: candidate.feature,
      retrieval: candidate.retrieval,
      now,
    });
  }
  const selectedIds = new Set(candidates.map((candidate) => candidate.job.id));
  return candidates.map((candidate) => ({
    jobId: candidate.job.id,
    profileId: profile.id,
    profileVersion: profile.version,
    lexicalScore: candidate.lexical,
    featureScore: candidate.feature,
    retrievalScore: candidate.retrieval,
    llmScore: null,
    learnedScore: null,
    reasoning: null,
    gaps: [],
    strengths: [],
    flags: [],
    provider: null,
    model: null,
    cliVersion: null,
    scoredAt: now,
    job: candidate.job,
    company: candidate.company,
    triageDecision: decisions.get(candidate.job.id) ?? null,
  })).filter((match) => selectedIds.has(match.job.id));
}

export function listRankedMatches(
  profileId: number,
  options: { limit?: number; database?: JobHuntDatabase } = {},
): RankedMatch[] {
  const database = options.database ?? db;
  const limit = options.limit ?? 100;
  const decisions = latestTriage(database, profileId);
  const rows = database.select({ match: matches, job: jobs, company: companies })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(eq(matches.profileId, profileId), isNull(jobs.closedAt), eq(companies.active, true)))
    .all()
    .filter(({ job, company }) => !company.blocked && !["skip", "block_company"].includes(decisions.get(job.id) ?? ""))
    .sort((left, right) => {
      const leftScore = left.match.learnedScore ?? left.match.llmScore ?? Math.round(left.match.retrievalScore * 100);
      const rightScore = right.match.learnedScore ?? right.match.llmScore ?? Math.round(right.match.retrievalScore * 100);
      return rightScore - leftScore || right.match.retrievalScore - left.match.retrievalScore;
    })
    .slice(0, limit);
  return rows.map(({ match, job, company }) => ({
    ...match,
    job,
    company: { id: company.id, name: company.name, slug: company.slug, tier: company.tier },
    triageDecision: decisions.get(job.id) ?? null,
  }));
}
