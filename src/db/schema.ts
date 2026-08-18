import { desc, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * Companies are discovered from public boards and APIs. They are not a
 * hand-maintained allow-list, so discovery provenance is part of the row.
 */
export const companies = sqliteTable(
  "companies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    atsType: text("ats_type"),
    atsToken: text("ats_token"),
    careersUrl: text("careers_url"),
    tier: integer("tier").notNull().default(3),
    discoveredVia: text("discovered_via").notNull(),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" }).notNull(),
    lastProbeAt: integer("last_probe_at", { mode: "timestamp_ms" }),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    blocked: integer("blocked", { mode: "boolean" }).notNull().default(false),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("companies_slug_uq").on(table.slug),
    index("companies_ats_active_idx")
      .on(table.atsType, table.active)
      .where(sql`active`),
    index("companies_blocked_idx").on(table.blocked).where(sql`blocked`),
  ],
);

/**
 * One row is retained for every source copy of a posting. Deduplication can
 * point duplicate rows at a canonical job without deleting provenance.
 */
export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    source: text("source").notNull(),
    sourceId: text("source_id").notNull(),
    url: text("url").notNull(),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    description: text("description").notNull(),
    descriptionFts: text("description_fts"),
    location: text("location"),
    remoteType: text("remote_type"),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryPeriod: text("salary_period"),
    currency: text("currency"),
    seniority: text("seniority"),
    stack: text("stack", { mode: "json" }).$type<string[]>(),
    extractionTier: text("extraction_tier").notNull().default("none"),
    postedAt: integer("posted_at", { mode: "timestamp_ms" }),
    firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
    /**
     * The first successful board poll on which this source posting was absent.
     * A second successful absence closes it; an observed posting clears it.
     */
    missingSinceAt: integer("missing_since_at", { mode: "timestamp_ms" }),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    contentHash: text("content_hash").notNull(),
    canonicalId: integer("canonical_id").references(
      (): AnySQLiteColumn => jobs.id,
    ),
  },
  (table) => [
    uniqueIndex("jobs_source_source_id_uq").on(table.source, table.sourceId),
    index("jobs_company_posted_idx").on(
      table.companyId,
      desc(table.postedAt),
    ),
    index("jobs_content_hash_idx").on(table.contentHash),
    index("jobs_closed_idx").on(table.closedAt).where(sql`closed_at IS NULL`),
    index("jobs_last_seen_idx").on(table.lastSeenAt),
    index("jobs_missing_idx")
      .on(table.missingSinceAt)
      .where(sql`closed_at IS NULL AND missing_since_at IS NOT NULL`),
    index("jobs_canonical_idx").on(table.canonicalId),
  ],
);

/**
 * Per-company validators and outcomes for source polls. This keeps adapters
 * database-independent while allowing the worker to issue conditional
 * requests, respect cadence after failures, and explain a failed board.
 */
export const sourcePolls = sqliteTable(
  "source_polls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id),
    source: text("source").notNull(),
    etag: text("etag"),
    lastFetchedAt: integer("last_fetched_at", { mode: "timestamp_ms" }),
    lastSuccessfulAt: integer("last_successful_at", { mode: "timestamp_ms" }),
    /** The worker's persisted cadence/backoff decision. */
    nextPollAt: integer("next_poll_at", { mode: "timestamp_ms" }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    lastStatus: text("last_status"),
    lastError: text("last_error"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("source_polls_company_source_uq").on(
      table.companyId,
      table.source,
    ),
    index("source_polls_source_fetched_idx").on(
      table.source,
      table.lastFetchedAt,
    ),
    index("source_polls_source_due_idx").on(table.source, table.nextPollAt),
  ],
);

export type CareerPageSelectors = {
  item: string;
  title: string;
  url: string;
  location?: string;
  description?: string;
};

export const extractionRules = sqliteTable(
  "extraction_rules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id").notNull().references(() => companies.id),
    domain: text("domain").notNull(),
    domFingerprint: text("dom_fingerprint").notNull(),
    selectors: text("selectors", { mode: "json" }).$type<CareerPageSelectors>().notNull(),
    generatedAt: integer("generated_at", { mode: "timestamp_ms" }).notNull(),
    generatedBy: text("generated_by"),
    lastOkAt: integer("last_ok_at", { mode: "timestamp_ms" }),
    failCount: integer("fail_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("extraction_rules_company_domain_uq").on(table.companyId, table.domain),
    index("extraction_rules_fail_idx").on(table.failCount),
  ],
);

/**
 * Every structured CLI invocation is retained as both a cache entry and an
 * audit record. The unique key deliberately includes the rendered prompt
 * version so changing a prompt cannot reuse an old answer silently.
 */
export const llmRuns = sqliteTable(
  "llm_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    cliVersion: text("cli_version"),
    promptHash: text("prompt_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    rawOutput: text("raw_output"),
    parsed: text("parsed", { mode: "json" }).$type<unknown>(),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    durationMs: integer("duration_ms"),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("llm_runs_cache_uq").on(
      table.task,
      table.promptHash,
      table.provider,
      table.model,
      table.promptVersion,
    ),
    index("llm_runs_task_created_idx").on(table.task, table.createdAt),
  ],
);

export type ResumeProfileJson = {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  portfolioUrl?: string;
  headline?: string;
  summary?: string;
  interests?: string[];
  experience?: Array<{
    company: string;
    title: string;
    startDate?: string;
    endDate?: string;
    bullets: string[];
  }>;
  education?: Array<{ school: string; degree?: string; field?: string }>;
  projects?: Array<{ name: string; description: string; technologies?: string[] }>;
};

export type ProfilePreferences = {
  remoteTypes?: Array<"remote" | "hybrid" | "onsite">;
  locations?: string[];
  minSalary?: number;
  currencies?: string[];
  seniorities?: string[];
  visaKeywords?: string[];
  exclusions?: string[];
  targetCompanies?: string[];
};

/** Versioned, hand-editable search profile. The first row is the active profile. */
export const profiles = sqliteTable(
  "profiles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    version: integer("version").notNull().default(1),
    resumeJson: text("resume_json", { mode: "json" })
      .$type<ResumeProfileJson>()
      .notNull(),
    skills: text("skills", { mode: "json" }).$type<string[]>().notNull(),
    titleAliases: text("title_aliases", { mode: "json" }).$type<string[]>().notNull(),
    skillAliases: text("skill_aliases", { mode: "json" })
      .$type<Record<string, string[]>>()
      .notNull(),
    queryTerms: text("query_terms", { mode: "json" })
      .$type<Record<string, number>>()
      .notNull(),
    preferences: text("preferences", { mode: "json" })
      .$type<ProfilePreferences>()
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("profiles_updated_idx").on(table.updatedAt)],
);

/** Fast lexical and structured retrieval output, one current row per job/profile. */
export const matches = sqliteTable(
  "matches",
  {
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id),
    profileVersion: integer("profile_version").notNull(),
    lexicalScore: real("lexical_score").notNull(),
    featureScore: real("feature_score").notNull(),
    retrievalScore: real("retrieval_score").notNull(),
    llmScore: integer("llm_score"),
    learnedScore: real("learned_score"),
    reasoning: text("reasoning"),
    gaps: text("gaps", { mode: "json" }).$type<string[]>().notNull(),
    strengths: text("strengths", { mode: "json" }).$type<string[]>().notNull(),
    flags: text("flags", { mode: "json" }).$type<string[]>().notNull(),
    provider: text("provider"),
    model: text("model"),
    cliVersion: text("cli_version"),
    scoredAt: integer("scored_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.jobId, table.profileId] }),
    index("matches_profile_score_idx").on(table.profileId, table.retrievalScore),
    index("matches_profile_llm_idx").on(table.profileId, table.llmScore),
  ],
);

/** Append-only human labels used immediately for triage and later learning. */
export const triage = sqliteTable(
  "triage",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id")
      .notNull()
      .references(() => jobs.id),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id),
    decision: text("decision").notNull(),
    reason: text("reason"),
    decidedAt: integer("decided_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("triage_job_profile_idx").on(table.jobId, table.profileId),
    index("triage_decided_idx").on(table.decidedAt),
  ],
);

export const resumeVariants = sqliteTable(
  "resume_variants",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id").notNull().references(() => jobs.id),
    resumeJson: text("resume_json", { mode: "json" }).$type<ResumeProfileJson>().notNull(),
    coverLetter: text("cover_letter"),
    pdfPath: text("pdf_path"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("resume_variants_job_idx").on(table.jobId, table.createdAt)],
);

/**
 * A local worker queue for tailoring. The UI may enqueue a request, but only
 * the CLI worker performs LLM work or launches Chromium to render a PDF.
 */
export const tailorRequests = sqliteTable(
  "tailor_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id").notNull().references(() => jobs.id),
    status: text("status").notNull().default("queued"),
    variantId: integer("variant_id").references(() => resumeVariants.id),
    error: text("error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("tailor_requests_status_created_idx").on(table.status, table.createdAt),
    index("tailor_requests_job_created_idx").on(table.jobId, table.createdAt),
  ],
);

export const applications = sqliteTable(
  "applications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id").notNull().references(() => jobs.id),
    status: text("status").notNull().default("draft"),
    appliedAt: integer("applied_at", { mode: "timestamp_ms" }),
    resumeVariantId: integer("resume_variant_id").references(() => resumeVariants.id),
    coverLetter: text("cover_letter"),
    nextFollowupAt: integer("next_followup_at", { mode: "timestamp_ms" }),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("applications_job_uq").on(table.jobId),
    index("applications_status_followup_idx").on(table.status, table.nextFollowupAt),
  ],
);

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id").notNull().references(() => applications.id),
    type: text("type").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index("events_application_occurred_idx").on(table.applicationId, table.occurredAt)],
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    companyId: integer("company_id").notNull().references(() => companies.id),
    name: text("name"),
    role: text("role"),
    email: text("email"),
    linkedin: text("linkedin"),
    notes: text("notes"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("contacts_company_idx").on(table.companyId)],
);

/** A durable record of a form-fill attempt. It always ends before submission. */
export const applicationRuns = sqliteTable(
  "application_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    applicationId: integer("application_id").notNull().references(() => applications.id),
    adapter: text("adapter").notNull(),
    status: text("status").notNull(),
    fields: text("fields", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
    error: text("error"),
  },
  (table) => [index("application_runs_application_idx").on(table.applicationId, table.startedAt)],
);

export const rankingFeedback = sqliteTable(
  "ranking_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: integer("job_id").notNull().references(() => jobs.id),
    profileId: integer("profile_id").notNull().references(() => profiles.id),
    outcome: text("outcome").notNull(),
    features: text("features", { mode: "json" }).$type<Record<string, number>>().notNull(),
    retrievalScore: real("retrieval_score").notNull(),
    llmScore: integer("llm_score"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("ranking_feedback_profile_idx").on(table.profileId, table.createdAt)],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type SourcePoll = typeof sourcePolls.$inferSelect;
export type NewSourcePoll = typeof sourcePolls.$inferInsert;
export type ExtractionRule = typeof extractionRules.$inferSelect;
export type NewExtractionRule = typeof extractionRules.$inferInsert;
export type LlmRun = typeof llmRuns.$inferSelect;
export type NewLlmRun = typeof llmRuns.$inferInsert;
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
export type Triage = typeof triage.$inferSelect;
export type NewTriage = typeof triage.$inferInsert;
export type ResumeVariant = typeof resumeVariants.$inferSelect;
export type NewResumeVariant = typeof resumeVariants.$inferInsert;
export type TailorRequest = typeof tailorRequests.$inferSelect;
export type NewTailorRequest = typeof tailorRequests.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type ApplicationRun = typeof applicationRuns.$inferSelect;
export type NewApplicationRun = typeof applicationRuns.$inferInsert;
export type RankingFeedback = typeof rankingFeedback.$inferSelect;
export type NewRankingFeedback = typeof rankingFeedback.$inferInsert;
