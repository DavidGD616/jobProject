# 05 — Roadmap

**Status:** Current · **Last updated:** 2026-08-17

Each phase ships something usable. Do not start a phase before the previous one's exit criteria are met.

## Phase 0 — Decisions ✅ done

All ten ADRs accepted. Stack and policy settled:

- **TypeScript on Node 24**, pnpm, single language ([ADR-0003](adr/0003-typescript-single-language.md))
- **SQLite + FTS5**, WAL mode, one file ([ADR-0002](adr/0002-storage-engine.md))
- **Local-only**, bound to `127.0.0.1` ([ADR-0006](adr/0006-local-only-execution.md))
- **LLM via installed CLIs** — `claude`, `codex`, `opencode` ([ADR-0007](adr/0007-llm-via-cli-subprocess.md))
- **No embeddings** — lexical + feature retrieval ([ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md))
- **Local Playwright**, agent-generated selectors cached per site ([ADR-0009](adr/0009-local-browser-automation.md))
- **Company list is discovered**, not curated ([ADR-0010](adr/0010-company-discovery.md))

## Phase 1 — Ingest pipeline ✅ done

The one that proves the whole thing works. Tier A of [00-vision](00-vision.md).

- ✅ Repo scaffold (pnpm), DB schema, migrations
- ✅ **Discovery: bulk probe + automatic seed.** The latest 36 HN threads produce candidates from top-level listings with official ATS URLs and token-matched company headings, without a hand-maintained company list. The probe verifies boards, caches misses, and stops safely after upstream failure signals.
- ✅ Source contract + adapters for Greenhouse, Lever, Ashby
- ✅ Heuristic extraction at ingest — regex salary, title seniority, remote keywords
- ✅ Dedup layers 1 and 2
- ✅ Scheduled fetch with ETag state, backoff, and a two-snapshot `last_seen_at` / `closed_at` staleness sweep
- ✅ Minimal local list UI: filter by company, title, date

*Exit verified 2026-08-17:* `pnpm discover:seed` processed 424 candidates and verified 322 live official boards unattended. The first `pnpm jobs:fetch` stored 10,309 open jobs with a 3.77% duplicate rate; the immediately repeated pass observed four new upstream postings and no local duplicate or stale-closure churn. A normal subsequent run found no boards due before the persisted six-hour cadence.

The bulk probe is deliberately rate-limited across the three public ATS hosts. Keep those safeguards in place for future seed runs.

## Phase 1.5 — LLM harness ✅ done

Build the CLI layer before anything depends on it. Debugging matching and the provider layer at the same time is the thing this phase exists to prevent.

- ✅ Provider adapters for `claude` and `codex`, with pinned non-interactive flags
- ✅ Sandboxing: tools disabled, empty temp `cwd`, hard timeout with kill
- ✅ Parse ladder + one repair retry
- ✅ `llm_runs` cache with the full key
- ✅ Task → provider routing with fallback chain
- ✅ `pnpm llm:bench` benchmark harness for latency, parse failures, and batch size

*Exit:* the same prompt runs through two providers and returns valid parsed JSON ≥95% of the time; the second run is served from cache; a killed CLI does not wedge the worker.

Also worth settling here: whether `opencode serve` beats subprocess invocation on latency ([ADR-0007](adr/0007-llm-via-cli-subprocess.md), Open).

## Phase 2 — Enrich + match ✅ done

Tier B. Depends on Phase 1.5.

- ✅ Structured profile input, `resume_json`, alias lists
- ✅ Boilerplate stripping, lexical + feature retrieval, and stage-one filters
- ✅ Batched LLM rerank with field extraction in the same call
- ✅ LLM query expansion cached per profile version
- ✅ Ranked review UI, triage buttons, and one-click `block_company`
- ✅ Few-shot feedback from triage labels
- ✅ Profile-driven Adzuna discovery and reverse ATS URL extraction through the shared verifier
- ✅ Career-page rendering through local Chromium with cached selectors and zero-row failure handling ([ADR-0009](adr/0009-local-browser-automation.md))

*Exit:* daily top-20 is good enough that you stop browsing raw listings. Precision@20 above ~50% by click-through, and known-good jobs reliably survive stage 2.

Check stage 2 recall before tuning stage 3. If good jobs never reach the reranker, no amount of prompt work fixes it.

## Phase 3 — Tracking ✅ done

Small, unglamorous, high daily value. Do it before tailoring — it pays off from the first application.

- ✅ Application records and status board
- ✅ Append-only `events` timeline
- ✅ Follow-up reminders
- ✅ Contacts per company
- ✅ Basic funnel stats

*Exit:* every application lives here, not in memory or a spreadsheet.

## Phase 4 — Tailoring ✅ done

Tier C, first half.

- ✅ Bullet selection and deterministic reordering from real facts only
- ✅ Grounded cover-letter draft, human-edited in the UI
- ✅ HTML and optional local Chromium PDF rendering from `resume_json`
- ✅ `resume_variants` — every export is tied to its destination

*Exit:* a tailored, human-approved resume + letter in under 10 minutes.

## Phase 5 — Assisted apply ✅ done

Tier C, second half. Last because it is the most brittle.

- ✅ Per-ATS form plans for Greenhouse, Lever, and a generic fallback
- ✅ Local Chromium field filling and resume upload, with a **hard stop before submit** ([ADR-0004](adr/0004-human-in-the-loop-submission.md))
- ✅ Custom questions are surfaced for manual answers rather than guessed

*Exit:* Greenhouse and Lever forms fill correctly, and submission is always a human click.

## Phase 6 — Learning ✅ implemented

Only once there is real data.

- ✅ Logistic regression over the same structured features stage 2 computes, blended with LLM score
- ✅ Outcome loop from application and triage results
- ✅ `pnpm jobs:learn` model training and bounded learned-score persistence

*Operational follow-up:* collect enough local labels to measure ranking improvement over the Phase 2 baseline. If it does not improve, delete the blend.

## Current commands

The local UI is available at `/`, `/profile`, `/review`, `/pipeline`, `/tailor`,
and `/apply`. Worker commands are intentionally separate from request paths:

- `pnpm discover:seed` and `pnpm jobs:fetch` maintain the official ATS ledger. Discovery uses HN plus optional profile-driven Adzuna candidates when local credentials are configured.
- `pnpm career:fetch -- --company-id <id>` is the worker-only career-page path: it replays a cached rule and creates or repairs one when required.
- `pnpm jobs:rank`, `pnpm jobs:learn`, and `pnpm llm:bench` run ranking work.
- `pnpm tailor`, `pnpm apply:prepare`, and `pnpm apply:fill` prepare human-reviewed application materials.

All browser work is local Chromium. No LLM or browser call runs in a page
request, and no command contains a submission operation.

## Deliberately deferred

| Thing | Until |
|---|---|
| Deploy / hosting | Never — [ADR-0006](adr/0006-local-only-execution.md) |
| Multi-user, auth | Never |
| Hosted LLM API | Never — [ADR-0007](adr/0007-llm-via-cli-subprocess.md) |
| Embeddings / local models | Stage 2 recall proves to be the bottleneck and alias lists stop helping — [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md) |
| Email ingestion for status updates | Phase 3 proves manual tracking is the bottleneck |
| Mobile UI | Never |
| More than ~5 sources | Phase 1 is stable with 3 |
