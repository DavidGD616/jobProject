import { desc, sql } from "drizzle-orm";
import {
  index,
  integer,
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

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type SourcePoll = typeof sourcePolls.$inferSelect;
export type NewSourcePoll = typeof sourcePolls.$inferInsert;
export type LlmRun = typeof llmRuns.$inferSelect;
export type NewLlmRun = typeof llmRuns.$inferInsert;
