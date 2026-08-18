# 01 — Architecture

**Status:** Current · **Last updated:** 2026-08-18

## Shape

Local-only single-tenant app ([ADR-0006](adr/0006-local-only-execution.md)). One web process (UI + API), one worker process (scheduled + queued jobs), one database. No microservices — the boundaries below are modules, not deployments. Binds to `127.0.0.1` only.

LLM work is done by shelling out to installed AI CLIs ([ADR-0007](adr/0007-llm-via-cli-subprocess.md)), not a hosted API. That decision shapes most of what follows: invocations cost 5–30s, so everything LLM-dependent is batched, cached, and off the request path.

```
 ┌──────────────────────────────────────────────────────────────┐
 │  DISCOVERY         weekly. finds COMPANIES, not postings     │
 │                    probe · HN hiring · aggregator · rev-url  │
 │                    → rows in companies                       │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  SOURCES                                                     │
 │  Tier 1  ATS JSON boards (Greenhouse · Lever · Ashby · …)    │
 │  Tier 2  rendered career pages (local Playwright + cached    │
 │          selectors)                                          │
 │  Tier 3  Adzuna                                              │
 └───────────────────────────┬──────────────────────────────────┘
                             │  scheduled fetch (default every 6h)
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  INGEST            adapter per source → RawPosting           │
 │                    normalize → canonical Job + heuristics    │
 │                    dedup (content hash + fuzzy title match)  │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  INGEST / INDEX    strip boilerplate → description_fts       │
 │                    → trigger-maintained jobs_fts (FTS5)      │
 │                    no LLM here. 10k jobs × a CLI call = 27h  │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  MATCH             1. hard filters (visa, geo, salary floor) │
 │                    2. title-weighted FTS5 BM25 + features     │
 │                       + weighted exact-term tie-break → ~60   │
 │                    3. LLM rerank → score + reasons + gaps    │
 │                       + corrected field extraction, same call │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  REVIEW UI         ranked list · interested / skip / block   │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  TAILOR            UI queues → local CLI worker claims next  │
 │                    selects stored facts; grounded letter      │
 │                    → human edits; render existing template    │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  APPLY             per-ATS form adapter fills fields         │
 │                    HARD STOP → human reviews → human submits │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  TRACK             status board · follow-up reminders        │
 │                    outcome events feed back into MATCH       │
 └──────────────────────────────────────────────────────────────┘
```

## Feedback loops

Two loops are what make the system improve rather than just aggregate:

1. **Triage loop.** Every `interested` / `skip` / `block` click is labelled training data. Start by feeding recent labels into the LLM rerank prompt as few-shot examples. Only move to a trained classifier once there are a few hundred labels.
2. **Outcome loop.** Application status transitions (`applied → responded → interview`) reveal which job traits actually convert. Feeds the ranking prior. Low volume, so treat as directional, not statistical.

## Component contracts

| Module | Input | Output | Runs |
|---|---|---|---|
| `discovery/*` | candidate names, URLs | rows in `companies` | weekly |
| `sources/*` | company row + cached validator | `SourceFetchResult<RawPosting>` | scheduled |
| `ingest` | `RawPosting[]` | normalized, heuristically enriched `jobs` rows with stripped `description_fts` | scheduled |
| `match` | `Job[]`, `Profile` | FTS5 candidates and rows in `matches`; legacy `description_fts` NULLs backfilled once | local rank/review refresh. **no LLM** |
| `llm` | task + prompt | parsed result, cached | called by match / tailor / discovery |
| `tailor_requests` | job selected in `/tailor` | coalesced queued local-worker request | UI request: SQLite write only |
| `tailor` | claimed request, `Job`, `Profile` | resume variant, grounded editable cover letter, HTML export and PDF when Chromium is available | local CLI worker: `pnpm tailor -- --next` |
| `apply` | `Job`, artifacts | filled form, paused | on demand, interactive |

**Source adapter contract** — every adapter exports the same shape; its registry entry supplies cadence and request policy:

```
fetch(config)      → SourceFetchResult<RawPosting> // network, retries, rate limit
normalize(raw)     → NormalizedPosting // pure, no I/O, unit-testable
sourceId(raw)      → string           // stable per-source unique id
```

`NormalizedPosting` is the source-owned part of a canonical job: the URL,
title, normalized title, sanitized description, and source-supplied metadata.
Ingest combines it with the known company and registered adapter to add
`company_id`, `source`, `source_id`, observation timestamps, the content hash,
and deduplication links. It computes `content_hash` from `title_norm`, the
company slug, and the description with the shared helper. It applies
deterministic salary, seniority, and remote heuristics only where the source
left a field empty, and writes the resulting `extraction_tier`. Ingest writes
the boilerplate-stripped `description_fts` whenever it observes a job; matching
only backfills legacy open rows where that column is `NULL`. The staleness sweep
alone writes `closed_at`.

`normalize` being pure and I/O-free is the rule that keeps ingest testable
against recorded fixtures. Source-supplied values remain authoritative. The
`jobs_fts` external-content FTS5 table is backfilled by its migration and kept
in sync by database triggers on every `jobs` insert, delete, and indexed-field
update. Its `rowid` is `jobs.id`; matching joins on that key and uses
title-weighted `bm25()` over `title` and `description_fts`.

The `/tailor` UI never launches Chromium or calls an LLM. It creates one active
`tailor_requests` row per job; `pnpm tailor -- --next` claims the oldest queued
row, creates the variant, renders its local export, and marks the request
completed or failed. The worker builds an evidence-grounded plan from stored
facts: a separate target-role headline and summary, focused projects and
skills, a complete work history, and a job-aware draft letter. It puts direct
and transferable source facts first but retains every saved role, employer
title, date, and bullet. A user-authored featured project is always included
ahead of relevance-ranked projects; the worker never infers feature status or
recency from project-array order. It records its evidence map, fit/gap
assessment, profile version, job hash, and prompt version with the variant. It
never changes historical facts, and the UI keeps the letter human-editable
while flagging stale form-checklist snapshots. Rendering preserves the existing
Harvard resume template ([ADR-0013](adr/0013-complete-work-history-tailoring.md)).

`SourceFetchResult` distinguishes `{ kind: "fetched", postings, etag }` from
`{ kind: "not_modified", etag }`. The scheduled poller persists each ETag by
company and source, sends it on the next fetch, and skips ingest/staleness work
on `not_modified`; an HTTP 304 must never look like a fetched empty board.

Rendered career-page sources implement the same contract. Their `fetch` renders with local Playwright and applies cached selectors from `extraction_rules`; their `normalize` is identical in kind to an ATS adapter's ([ADR-0009](adr/0009-local-browser-automation.md)).

**Discovery source contract** — finds companies, not postings:

```
discover(config)  → CandidateCompany[]    // name, ats hints, provenance
verify(candidate) → Company | null        // probe the board; 404 → null
```

`verify` is what makes discovery cheap: an ATS endpoint returns 200 with JSON for a real token and 404 otherwise, so wrong guesses cost one HTTP request.

The initial unattended seed derives candidates from the latest 36 monthly HN
hiring threads rather than a hand-maintained company file. Its
conservative parser admits only top-level listings with an exact official
Greenhouse, Lever, or Ashby board URL. Explicit `Company:` headings are
accepted; pipe headings must normalize to that board's token, which excludes
role, location, and person prefixes. The URL provides one ATS hint for the
shared verifier; richer prose parsing waits for the batched, cached LLM harness
in Phase 1.5.

**LLM provider contract** — one adapter per installed CLI, in `src/llm/providers/`:

```
run(prompt, opts)  → { text, raw, provider, model, cliVersion, durationMs }
capabilities()     → { structuredOutput, maxPromptChars, concurrency }
health()           → boolean          // installed and authenticated?
```

Adapters available on this machine:

| Provider | Invocation | Structured output |
|---|---|---|
| `claude` | `claude -p <prompt>` | JSON envelope via `--output-format json` |
| `codex` | `codex exec <prompt>` | prose — parse ladder required |
| `opencode` | `opencode run <message>` | prose — parse ladder required |

Callers never pick a provider directly. They name a **task** (`extract`, `rerank`, `expand_query`, `tailor`) and config routes it, with a fallback chain on failure or rate limit. Exact flags per CLI are pinned during Phase 1.5 and recorded in the `llm-provider` skill.

## Sync vs async

- **Synchronous** (blocks the request): reads, filters, browsing, and queue
  writes in the UI. Stage 1 and stage 2 of matching are local SQL/FTS work.
- **Asynchronous** (off the UI request): all network fetches and LLM work.
  Tailoring LLM/PDF work is claimed from `tailor_requests` by the local
  `pnpm tailor -- --next` worker.

No LLM call ever sits in a request path. At 5–30s per invocation this is not a guideline. Every LLM-dependent view must render correctly with the result **missing or stale** — jobs without an `llm_score` fall back to their retrieval rank rather than disappearing.

## Stack

Settled in Phase 0. All ADRs accepted.

| Layer | Choice | ADR |
|---|---|---|
| Language / runtime | TypeScript on Node 24 | [0003](adr/0003-typescript-single-language.md) |
| Package manager | pnpm — all commands and scripts use it, never npm or yarn | |
| Database | SQLite + FTS5, WAL mode, one file | [0002](adr/0002-storage-engine.md) |
| ORM / migrations | Drizzle | |
| Web | Next.js, bound to `127.0.0.1` | [0006](adr/0006-local-only-execution.md) |
| Queue | polled table in SQLite | [0002](adr/0002-storage-engine.md) |
| LLM | subprocess to `claude` / `codex` / `opencode` | [0007](adr/0007-llm-via-cli-subprocess.md) |
| Validation | zod — doubles as the LLM parse ladder | |
| Retrieval | FTS5 `bm25()` + structured features | [0008](adr/0008-no-embeddings-lexical-retrieval.md) |
| Browser | Playwright, local only — never a cloud browser service | [0009](adr/0009-local-browser-automation.md) |
| UI | Tailwind | |

## Repo layout

Single package until it hurts.

```
docs/                    plans, ADRs, research
src/
  discovery/             finds companies (ADR-0010)
    probe.ts             slug → ATS endpoint → 200 or 404
    hn-hiring.ts         Algolia API → company names
    adzuna.ts            profile role/location → candidates
    reverse-url.ts       apply URL → ATS token
    _contract.ts
  sources/               one dir per source, finds postings
    registry.ts           source cadence, User-Agent, and request policy
    rate-limit.ts         shared concurrency and request-start limiter
    greenhouse/          fetch.ts · normalize.ts · fixtures/
    lever/
    career-page/         Playwright render + cached selectors (ADR-0009)
    _contract.ts         shared adapter types
  browser/               Playwright session mgmt, robots.txt checks
  ingest/                normalize pipeline, heuristic extraction, dedup
  enrich/                boilerplate stripping, FTS preparation
  llm/                   provider abstraction
    providers/           claude.ts · codex.ts · opencode.ts
    parse.ts             parse ladder + repair retry
    cache.ts             llm_runs read/write
    routing.ts           task → provider + fallback chain
  match/                 filters, lexical retrieval, rerank
  tailor/                resume selection, cover letter, PDF
  apply/                 per-ATS form adapters (Playwright)
  db/                    schema, migrations, queries
  jobs/                  queue definitions, schedules
  app/                   Next.js routes + UI
  lib/                   shared utils, LLM client, config
tests/
  fixtures/              recorded API responses, committed
scripts/                 one-off maintenance
```

## Cross-cutting rules

- **Fixtures over live calls in tests.** Record one real response per source into `tests/fixtures/`, test `normalize` against it. Source APIs change; the fixture diff is how you find out.
- **Cache every LLM result.** Key on `(task, content_hash, profile_version, provider, model, prompt_version)`. At CLI latency this is load-bearing, not an optimization.
- **Every external call gets a timeout, retry with backoff, and a per-source rate limit.** No exceptions — one unbounded fetch loop against a public API is how you get IP-banned. Before each source origin is used, its `robots.txt` policy is loaded and cached by the source client, its matching allow/disallow rules are enforced, and any stricter `Crawl-delay` raises the shared limiter floor.
- **Every CLI invocation runs sandboxed.** Tools disabled, `cwd` set to an empty temp directory, hard timeout with kill on expiry. These are agentic tools doing a single-shot task; without this an agent pointed at this repo will read this repo.
- **Per-provider concurrency cap of 1–2.** Fanning out processes against one subscription gets you rate-limited, and the limits are not observable from here.
- **Never crash a batch on a parse failure.** Record `parse_failed`, continue, retry next run.
- **Never LLM-enrich every job.** Heuristics at ingest, LLM only inside the stage 3 rerank call. Enriching all of them is ~27h per run and would kill the project.
- **Zero extracted rows from a career page is a failure, not an empty result.** A redesigned page and a company with no openings must never look the same.
- **Browser automation is local Playwright only.** No cloud browser service ([ADR-0009](adr/0009-local-browser-automation.md)).
- **No API keys for LLMs.** Credentials live in each CLI's own config, outside this project.
- **Config over code for source lists and provider routing.** Adding a company or changing which CLI handles a task edits config, not source files.
