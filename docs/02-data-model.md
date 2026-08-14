# 02 — Data model

**Status:** Draft · **Last updated:** 2026-08-13
**Engine:** SQLite + FTS5, WAL mode ([ADR-0002](adr/0002-storage-engine.md)).

Types below are written generically. In SQLite, `text[]` is stored as a JSON array and `json` as `TEXT`. Anything that needs filtering must be a real column, never a key inside a JSON blob.

## Tables

```sql
-- Companies. Discovered, not hand-written (ADR-0010).
companies (
  id             integer pk
  name           text not null
  slug           text unique not null     -- normalized, for dedup joins
  ats_type       text                     -- greenhouse | lever | ashby | workable | null
  ats_token      text                     -- board identifier for that ATS
  careers_url    text                     -- used only when ats_type is null
  tier           integer default 3        -- 1 = dream, 3 = default, 5 = never.
                                          -- OPTIONAL. Never required to be set
  discovered_via text not null            -- probe | hn_hiring | aggregator
                                          --   | reverse_url | manual
  discovered_at  timestamp not null
  last_probe_at  timestamp                -- when its board was last confirmed alive
  active         boolean default true     -- false once the board stops returning jobs
  blocked        boolean default false    -- set by "never show this company"
  notes          text
  created_at     timestamp
)

-- Cached selectors for rendered career pages (ADR-0009).
-- Generated once by a CLI agent, replayed deterministically.
extraction_rules (
  id              integer pk
  company_id      integer fk -> companies
  domain          text not null
  dom_fingerprint text not null           -- structural hash; change = regenerate
  selectors       json not null           -- { list, title, url, location, ... }
  generated_at    timestamp not null
  generated_by    text                    -- provider that produced them
  last_ok_at      timestamp               -- last run that extracted > 0 rows
  fail_count      integer default 0       -- consecutive zero-row runs
  unique (company_id, domain)
)

-- One row per posting per source. Deduped into a canonical job below.
jobs (
  id             integer pk
  company_id     integer fk -> companies
  source         text not null             -- adapter name
  source_id      text not null             -- stable id within that source
  url            text not null
  title          text not null
  title_norm     text not null             -- lowercased, seniority/noise stripped
  description    text not null             -- sanitized to plain text at normalize
  description_fts text                     -- boilerplate stripped, for indexing only
  location       text
  remote_type    text                      -- onsite | hybrid | remote | unknown
  salary_min     integer
  salary_max     integer
  salary_period  text                      -- year | month | hour
  currency       text
  seniority      text                      -- intern | junior | mid | senior | staff | lead
  stack          text[]                    -- extracted technologies
  extraction_tier text default 'none'      -- none | heuristic | llm
                                           -- highest tier applied so far.
                                           -- Values the source supplied directly
                                           -- are authoritative and never overwritten
  posted_at      timestamp
  first_seen_at  timestamp not null
  last_seen_at   timestamp not null        -- bump every fetch that still lists it
  closed_at      timestamp                 -- set when it stops appearing
  content_hash   text not null             -- sha256(title_norm + company + description)
  canonical_id   integer fk -> jobs        -- null if this row IS canonical
  unique (source, source_id)
)

-- Your structured resume + search preferences. Small, versioned, hand-edited.
profile (
  id              integer pk
  version         integer not null         -- bump on any edit; part of every cache key
  resume_json     json not null            -- structured, NOT a PDF blob
  skills          text[]
  title_aliases   text[]                   -- "ML Engineer" ~ "Applied Scientist"
  skill_aliases   json                     -- { "postgres": ["psql","postgresql"] }
  query_terms     json                     -- LLM-expanded weighted terms, cached
  preferences     json                     -- geo, salary floor, visa, exclusions
  updated_at      timestamp
)

-- Output of the match pipeline. Recomputed when profile version or job changes.
matches (
  job_id         integer fk -> jobs
  profile_id     integer fk -> profile
  profile_version integer not null
  lexical_score  real                      -- BM25, normalized, stage 2a
  feature_score  real                      -- structured features, stage 2b
  retrieval_score real                     -- weighted combination, stage 2c
  llm_score      integer                   -- 0-100, stage 3. null if not reranked
  reasoning      text
  gaps           text[]                    -- requirements you do not meet
  strengths      text[]
  flags          text[]
  provider       text                      -- claude | codex | opencode
  model          text
  cli_version    text
  scored_at      timestamp
  primary key (job_id, profile_id)
)

-- Cache and audit trail for every LLM CLI invocation.
llm_runs (
  id              integer pk
  task            text not null            -- extract | rerank | expand_query | tailor
  provider        text not null
  model           text
  cli_version     text
  prompt_hash     text not null            -- sha256 of the rendered prompt
  prompt_version  text not null            -- bump when the template changes
  raw_output      text                     -- keep it; prose parse failures are
                                           -- unreproducible from parsed alone
  parsed          json
  status          text not null            -- ok | parse_failed | timeout | error
                                           --   | rate_limited
  attempt         integer default 1        -- 2 = repair retry
  duration_ms     integer
  created_at      timestamp
  unique (task, prompt_hash, provider, model, prompt_version)
)

-- Your triage decisions. Training data for the feedback loop.
triage (
  job_id      integer fk -> jobs
  decision    text not null                -- interested | skip | block_company
  reason      text
  decided_at  timestamp
)

applications (
  id                integer pk
  job_id            integer fk -> jobs unique
  status            text not null          -- draft | applied | responded | screen
                                           -- | interview | offer | rejected | ghosted
  applied_at        timestamp
  resume_variant_id integer fk -> resume_variants
  cover_letter      text
  next_followup_at  timestamp
  notes             text
)

-- Every tailored resume kept, so you know what was actually sent.
resume_variants (
  id            integer pk
  job_id        integer fk -> jobs
  resume_json   json not null
  pdf_path      text
  created_at    timestamp
)

-- Append-only audit trail. Never update, only insert.
events (
  id              integer pk
  application_id  integer fk -> applications
  type            text not null            -- status_change | email | note | followup
  occurred_at     timestamp not null
  payload         json
)

contacts (
  id          integer pk
  company_id  integer fk -> companies
  name        text
  role        text
  email       text
  linkedin    text
  notes       text
)
```

## Design notes

**No embedding columns.** Per [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md), retrieval is lexical plus structured features. Adding vectors back later is one migration and a backfill — nothing else depends on them.

**Extraction is two-tier, and this is not optional.** LLM-extracting every job costs one CLI invocation per posting. At ~10,000 postings and ~10s per call that is over 27 hours per run — the feature would not exist. Instead:

| Tier | Mechanism | Applies to | Cost |
|---|---|---|---|
| `source` | Fields the API supplied directly | wherever present | free, authoritative |
| `heuristic` | Regex + title parsing at ingest — `senior`/`jr`, `$120k–150k`, `remote`/`hybrid` | every job | free, instant |
| `llm` | Folded into the stage 3 rerank call that already runs | only the ~60 that reach it | **zero extra calls** |

Daily LLM cost is therefore ~6 invocations, not 10,000. Never add an "enrich everything with the LLM" step — it is the single easiest way to make this project unusable.

`extraction_tier` records the highest tier applied. Source-supplied values always win; heuristics only fill nulls; the LLM only corrects what reaches stage 3.

**`companies` is populated by discovery, not by hand** ([ADR-0010](adr/0010-company-discovery.md)). `discovered_via` matters for debugging — when a batch of junk companies appears, it tells you which mechanism produced them. `tier` is optional and stays at its default for almost every row.

**`active` vs `blocked` are different things.** `active = false` means the board stopped responding. `blocked = true` means you never want to see it. Never conflate them: a blocked company's board is still alive, and an inactive one may come back.

**`extraction_rules.fail_count` is the self-healing trigger.** Consecutive zero-row runs mean the page was redesigned, not that the company has no openings. Regenerate the selectors when it crosses the threshold, and log it.

**`resume_json` is structured, not a blob.** This single choice is what makes Phase 4 possible — tailoring selects and reweights bullets, PDF rendering is a pure function of the structure. A stored PDF supports neither.

**`profile.version` exists to invalidate caches.** Every LLM result and every match row records the profile version that produced it. Without this, editing the resume silently leaves stale scores in place.

**`llm_runs` is both cache and audit.** The unique constraint makes it the cache. `raw_output` makes it debuggable — when prose parsing fails you cannot reconstruct what happened from the parsed value, because there isn't one. Retain raw output; it is small compared to job descriptions.

**`matches` records `provider` / `model` / `cli_version`.** Scores from different CLIs are not comparable ([ADR-0007](adr/0007-llm-via-cli-subprocess.md)). Without these columns a mixed run produces a ranked list that quietly means nothing.

**`llm_score` is nullable on purpose.** A run where some batches failed to parse is a normal outcome. Those jobs fall back to `retrieval_score` for ordering.

**Canonical rows via `canonical_id`, not deletion.** Keep every source's copy. One is canonical, the rest point at it. Preserves provenance and lets you compare what different sources reported for the same role.

**`last_seen_at` / `closed_at` instead of hard delete.** Postings vanish silently. A job absent from two consecutive fetches gets `closed_at` set. Never delete — historical postings are the dataset for the outcome loop.

**`events` is append-only.** Status lives on `applications` for querying; the transition history lives in `events`. Do not reconstruct one from the other.

**`description_fts` is separate from `description`.** The indexed copy has benefits, EEO statements, and company boilerplate stripped. BM25 over the raw text rewards whoever wrote the longest culture section. The LLM gets `description`; the index gets `description_fts`.

## Dedup strategy

Hardest correctness problem in the project. Three layers, cheapest first:

1. **Exact** — `unique (source, source_id)` stops re-ingesting the same posting from the same source. Free.
2. **Content hash** — `sha256(title_norm + company_slug + description)`. Catches the same job listed on a company board and an aggregator with identical text. Cheap.
3. **Fuzzy** — for jobs at the same company within a 30-day window: normalized-title similarity above threshold + location match → same role. Needs a company alias table (`Meta` / `Meta Platforms` / `Facebook`).

Title normalization before hashing: lowercase, strip seniority prefixes, strip `(m/f/d)`, `- Remote`, req IDs, and bracketed suffixes.

Fuzzy matching will produce false merges. Make merges reversible — that is another reason `canonical_id` beats deletion.

## Indexes

```
jobs (company_id, posted_at desc)     -- browse by company
jobs (content_hash)                    -- dedup layer 2
jobs (closed_at) where closed_at null  -- open jobs only, the common filter
jobs (last_seen_at)                    -- staleness sweep
companies (ats_type, active) where active  -- the fetch loop's driving query
companies (blocked) where blocked          -- filter exclusions
FTS index on jobs.description_fts + title    -- stage 2a retrieval
matches (retrieval_score desc)         -- ranked list without LLM
matches (llm_score desc)               -- ranked list with LLM
llm_runs (task, prompt_hash, provider, model, prompt_version)  -- cache lookup
applications (next_followup_at) where next_followup_at not null
```

FTS is an FTS5 virtual table (`jobs_fts`) over `title` + `description_fts`, joined on `job_id` and ranked with `bm25()`. It is not a column — keep it in sync on insert and update, or retrieval silently misses new jobs.
