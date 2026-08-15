# 05 — Roadmap

**Status:** Draft · **Last updated:** 2026-08-14

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

## Phase 1 — Ingest pipeline 🚧 in progress

The one that proves the whole thing works. Tier A of [00-vision](00-vision.md).

- ✅ Repo scaffold (pnpm), DB schema, migrations
- **Discovery: bulk probe ✅.** Candidate slugs → ATS endpoints → keep the 200s; the unattended 300-board exit run remains to be measured against a full candidate seed.
- Source contract + adapters for Greenhouse, Lever, Ashby — Greenhouse ✅; Lever and Ashby pending
- Heuristic extraction at ingest — regex salary, title seniority, remote keywords
- Dedup layers 1 and 2
- Scheduled fetch + `last_seen_at` / `closed_at` staleness sweep
- Minimal list UI: filter by company, title, date

*Exit:* `pnpm discover:seed` finds ≥300 live boards unattended; `pnpm fetch` pulls ≥5,000 open jobs; duplicate rate under 5%; re-running changes nothing but `last_seen_at`.

The probe is the riskiest part of this phase — it is thousands of requests against three hosts, and it runs before anything else works. Rate limit it before running it at scale.

## Phase 1.5 — LLM harness

Build the CLI layer before anything depends on it. Debugging matching and the provider layer at the same time is the thing this phase exists to prevent.

- Provider adapters for `claude` and one other (`codex` or `opencode`) — two is enough to prove the abstraction
- Pin exact non-interactive flags per CLI; record them in the `llm-provider` skill
- Sandboxing: tools disabled, empty temp `cwd`, hard timeout with kill
- Parse ladder + one repair retry
- `llm_runs` cache with the full key
- Task → provider routing with fallback chain
- **Bench** on 20 real job descriptions: latency, parse-failure rate, and useful batch size per provider

*Exit:* the same prompt runs through two providers and returns valid parsed JSON ≥95% of the time; the second run is served from cache; a killed CLI does not wedge the worker.

Also worth settling here: whether `opencode serve` beats subprocess invocation on latency ([ADR-0007](adr/0007-llm-via-cli-subprocess.md), Open).

## Phase 2 — Enrich + match

Tier B. Depends on Phase 1.5.

- Structured profile input, `resume_json`, alias lists
- Boilerplate stripping → `description_fts`, FTS5 index
- Stage 1 filters, stage 2 lexical + feature retrieval
- Stage 3 batched LLM rerank, **with field extraction folded into the same call**
- LLM query expansion, cached per profile version
- Ranked review UI with reasons and gaps, triage buttons, one-click `block_company`
- Few-shot feedback from triage labels
- Remaining discovery mechanisms: HN hiring, Adzuna query, reverse URL extraction
- Career-page sources: Playwright render + agent-generated selectors ([ADR-0009](adr/0009-local-browser-automation.md))

*Exit:* daily top-20 is good enough that you stop browsing raw listings. Precision@20 above ~50% by click-through, and known-good jobs reliably survive stage 2.

Check stage 2 recall before tuning stage 3. If good jobs never reach the reranker, no amount of prompt work fixes it.

## Phase 3 — Tracking

Small, unglamorous, high daily value. Do it before tailoring — it pays off from the first application.

- Application records, status board
- Append-only `events` timeline
- Follow-up reminders
- Contacts per company
- Basic funnel stats

*Exit:* every application lives here, not in memory or a spreadsheet.

## Phase 4 — Tailoring

Tier C, first half.

- Bullet selection and rewriting against a JD, from real facts only
- Cover letter draft, human-edited
- PDF rendering from `resume_json`
- `resume_variants` — always know what was sent

*Exit:* a tailored, human-approved resume + letter in under 10 minutes.

## Phase 5 — Assisted apply

Tier C, second half. Last because it is the most brittle.

- Per-ATS form adapters (Greenhouse and Lever first — largest coverage)
- Fill fields, upload resume, **hard stop before submit** ([ADR-0004](adr/0004-human-in-the-loop-submission.md))
- Detect and surface custom questions rather than guessing answers

*Exit:* Greenhouse and Lever forms fill correctly, and submission is always a human click.

## Phase 6 — Learning

Only once there is real data.

- Logistic regression over the same structured features stage 2 already computes, blended with LLM score
- Outcome loop from application results
- Precision tracking over time

*Exit:* measured ranking improvement over the Phase 2 baseline. If it does not improve, delete it.

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
