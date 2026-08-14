# ADR-0003 — TypeScript as the single language

**Status:** Accepted
**Date:** 2026-08-13

## Context

The project needs a web UI, scheduled network jobs, subprocess orchestration of AI CLIs, browser automation, and one small classifier in Phase 6.

Available locally: Node 24.6.0, Python 3.14.4, Docker 29.3.1.

Python is normally the stronger language for ML work, and that used to be the whole argument for a split stack. [ADR-0008](0008-no-embeddings-lexical-retrieval.md) removed embeddings, and [ADR-0007](0007-llm-via-cli-subprocess.md) turned LLM access into subprocess management. What remains of the "ML" work is Phase 6 logistic regression over a handful of features — which does not justify a second toolchain.

Meanwhile the work that actually dominates has shifted toward TypeScript strengths: spawning and killing child processes, parsing unreliable prose into validated JSON, full-text queries, and UI iteration.

## Options

### A. TypeScript everywhere
Next.js (UI + API), Drizzle (DB), Playwright (automation), `node:child_process` + zod (LLM layer).

- **Pro:** one language, one toolchain, shared types from DB row to React prop
- **Pro:** Playwright's TS API is the reference implementation
- **Pro:** zod gives the parse ladder in [ADR-0007](0007-llm-via-cli-subprocess.md) a validation layer with typed output for free
- **Con:** weaker ML libraries — now a minor cost, since the only ML left is Phase 6

### B. Python everywhere
FastAPI, SQLModel, Celery, scikit-learn.

- **Pro:** better tooling for Phase 6 modelling
- **Con:** UI story is worse — either a JS frontend anyway (defeating the point) or a compromise like Streamlit
- **Con:** Playwright-Python lags the TS API
- **Con:** the ML advantage now applies to one phase that may get deleted if it does not beat the baseline

### C. Split — Python pipeline, TypeScript UI
- **Pro:** each half uses its best tool
- **Con:** two toolchains, an API boundary, duplicated models, doubled CI. Real overhead for one developer, paid every day

## Decision

We will write the whole project in TypeScript on Node 24.

The hard parts here are ingest correctness, dedup, subprocess orchestration, and UI iteration speed — all TypeScript strengths. [ADR-0007](0007-llm-via-cli-subprocess.md) and [ADR-0008](0008-no-embeddings-lexical-retrieval.md) between them removed nearly everything that made Python attractive. End-to-end type safety from schema to component is worth more than a modelling library used in one phase that may get deleted.

## Consequences

- The LLM layer is `node:child_process` with zod validation. zod schemas double as the parse ladder's validation step and as the TypeScript types callers receive.
- Phase 6 modelling is hand-rolled or a small JS library. If it needs more than logistic regression, that is a signal to reconsider, not to force it.
- Types are shared from SQLite row to React prop. Schema changes surface as compile errors in the UI, which is the main practical payoff.
- Node is the only runtime to install and keep current. No virtualenv, no second lockfile, no serialization boundary in the middle of the pipeline.
- Playwright's TypeScript API is the reference implementation, so Phase 5 uses the best-supported path.

Escape hatch: if Phase 6 genuinely needs Python, add one narrow Python service for scoring only. That is a contained addition, not a rewrite — much cheaper than starting split.

## Revisit when

Phase 6 modelling needs anything beyond logistic regression, or local models come back into scope ([ADR-0008](0008-no-embeddings-lexical-retrieval.md)) — a local embedding runtime is the one thing that would genuinely favour Python again.
