# 01 — Architecture

**Status:** Draft · **Last updated:** 2026-08-13

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
 │                    normalize → canonical Job                 │
 │                    dedup (content hash + fuzzy title match)  │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  ENRICH            HEURISTIC only — regex + title parsing    │
 │                    strip boilerplate → description_fts        │
 │                    no LLM here. 10k jobs × a CLI call = 27h  │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  MATCH             1. hard filters (visa, geo, salary floor) │
 │                    2. lexical BM25 + feature score → ~60     │
 │                    3. LLM rerank → score + reasons + gaps    │
 │                       + corrected field extraction, same call │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  REVIEW UI         ranked list · interested / skip / block   │
 └───────────────────────────┬──────────────────────────────────┘
                             ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  TAILOR            select + rewrite resume bullets vs JD     │
 │                    draft cover letter → human edits          │
 │                    render PDF from structured resume         │
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
| `ingest` | `RawPosting[]` | rows in `jobs` | scheduled |
| `enrich` | `Job` | heuristic fields + `description_fts` | queued, per new job. **no LLM** |
| `match` | `Job[]`, `Profile` | rows in `matches` | queued, after enrich |
| `llm` | task + prompt | parsed result, cached | called by match / tailor / discovery |
| `tailor` | `Job`, `Profile` | resume variant + cover letter draft | on demand |
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
company slug, and the description with the shared helper. Enrich alone writes
`description_fts` and `extraction_tier`; the staleness sweep alone writes
`closed_at`.

`normalize` being pure and I/O-free is the rule that keeps ingest testable against recorded fixtures.

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

- **Synchronous** (blocks the request): reads, filters, browsing, everything in the review UI. Stage 1 and stage 2 of matching are both synchronous — they are pure SQL.
- **Asynchronous** (queued): all network fetches, all LLM calls, PDF rendering.

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
| UI | Tailwind + shadcn/ui | |

## Repo layout

Single package until it hurts.

```
docs/                    plans, ADRs, research
src/
  discovery/             finds companies (ADR-0010)
    probe.ts             slug → ATS endpoint → 200 or 404
    hn-hiring.ts         Algolia API → company names
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
  ingest/                normalize pipeline, dedup
  enrich/                heuristic extraction, boilerplate stripping
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
- **Every external call gets a timeout, retry with backoff, and a per-source rate limit.** No exceptions — one unbounded fetch loop against a public API is how you get IP-banned.
- **Every CLI invocation runs sandboxed.** Tools disabled, `cwd` set to an empty temp directory, hard timeout with kill on expiry. These are agentic tools doing a single-shot task; without this an agent pointed at this repo will read this repo.
- **Per-provider concurrency cap of 1–2.** Fanning out processes against one subscription gets you rate-limited, and the limits are not observable from here.
- **Never crash a batch on a parse failure.** Record `parse_failed`, continue, retry next run.
- **Never LLM-enrich every job.** Heuristics at ingest, LLM only inside the stage 3 rerank call. Enriching all of them is ~27h per run and would kill the project.
- **Zero extracted rows from a career page is a failure, not an empty result.** A redesigned page and a company with no openings must never look the same.
- **Browser automation is local Playwright only.** No cloud browser service ([ADR-0009](adr/0009-local-browser-automation.md)).
- **No API keys for LLMs.** Credentials live in each CLI's own config, outside this project.
- **Config over code for source lists and provider routing.** Adding a company or changing which CLI handles a task edits config, not source files.
