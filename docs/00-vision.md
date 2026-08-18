# 00 — Vision

**Status:** Current · **Last updated:** 2026-08-17

## Problem

Job hunting burns time on work that is mechanical, not judgment:

1. Finding openings — postings are scattered across hundreds of company ATS boards and aggregators, with heavy duplication.
2. Triage — most listings are irrelevant, but you only learn that after reading the description.
3. Tailoring — each application wants the same facts rephrased against a different job description.
4. Tracking — what was applied to, when, and what needs a follow-up.

The judgment parts (which company is worth joining, what to actually say) stay human. Everything above is automatable.

## Users

One user: the repo owner. Single-tenant, local-only. No multi-user auth, no sharing, no SaaS. If that changes, it's a different product.

## Operating constraints

Two constraints are chosen, not incidental. They shape the architecture more than any feature does.

**Everything runs on this machine** ([ADR-0006](adr/0006-local-only-execution.md)). No deployment, no hosted database, nothing inbound. The database holds a resume, salary expectations, target companies, and a rejection history — a complete career and financial profile. Outbound HTTPS to job boards is the only remote dependency.

**LLM work goes through installed AI CLIs, not a hosted API** ([ADR-0007](adr/0007-llm-via-cli-subprocess.md)). `claude`, `codex`, and `opencode` are already installed and already paid for. No API key lives in this project.

The cost is latency: 5–30s per invocation instead of ~2s. Everything
LLM-dependent is cached and kept off the request path; reranking is batched
where that amortizes CLI cost. A useful side effect — the system must work when
no CLI is available, so ingest, dedup, filtering, lexical ranking, and tracking
all run with zero LLM calls.

## Scope tiers

Build in order. Each tier ships and is useful alone.

### Tier A — Aggregator
Discover companies, pull their postings into one deduplicated database, filter and browse in a local UI.

*Done when:* a single query surfaces fresh, deduplicated openings across ≥300 companies without opening a browser tab — and the user never had to name one of them ([ADR-0010](adr/0010-company-discovery.md)).

### Tier B — Matcher
Score indexed candidates against a structured profile. Surface a short ranked
list with reasons and gaps. Retrieval is local FTS5/BM25 plus structured
features; reranking is a batched CLI call.

*Done when:* the daily top-20 list is good enough that manual browsing stops.

### Tier C — Assistant
Tailor resume and cover letter per job. Track the pipeline. Assist form fill. Remind about follow-ups.

*Done when:* time from "this job looks good" to "submitted" is under 10 minutes.

## Non-goals

- **Mass auto-submission.** Explicitly rejected — see [ADR-0004](adr/0004-human-in-the-loop-submission.md).
- **Scraping LinkedIn or Indeed.** No public job API, prohibited by ToS, aggressive bot detection, real risk to a personal account. See [ADR-0005](adr/0005-source-selection-policy.md).
- **Multi-user / hosted service.** Single-tenant, local-only by design.
- **Hosted LLM APIs.** No API key in this project — the installed CLIs are the interface.
- **Local model runtimes.** No Ollama, no ONNX weights, no embedding model. Out of scope for now; the consequence is [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md).
- **Fabricating experience.** Tailoring selects and reorders real profile facts;
  its cover-letter draft is grounded in them. It never invents skills, titles,
  dates, metrics, technologies, or outcomes.
- **Beating ATS keyword filters via stuffing.** Keyword alignment is a side effect of honest tailoring, not the objective.

## Success metrics

Track these from Phase 1 so later changes can be judged against them.

| Metric | Why it matters |
|---|---|
| Fresh jobs ingested / day | Pipeline health |
| Duplicate rate after dedup | Ingest quality |
| Stage 2 recall — do known-good jobs survive retrieval? | The weak point without embeddings |
| Precision@20 of the ranked list (judged by click-through) | Match quality |
| LLM parse-failure rate per provider | CLI layer health |
| Minutes from "interested" to "submitted" | Tier C payoff |
| Application → response rate | The only outcome that counts |

The last one is the north star. Everything else is a proxy.

## Working principle

Ship Tier A end-to-end before designing Tier C. A clean job table with honest dedup is worth more than a clever matcher over dirty data.
