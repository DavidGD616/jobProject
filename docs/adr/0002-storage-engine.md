# ADR-0002 — Storage engine: SQLite vs Postgres

**Status:** Accepted
**Date:** 2026-08-13

## Context

Needs: relational queries, full-text search, and a job queue. Single user, local-only, data volume in the low tens of thousands of rows. No concurrent writers beyond one worker process.

Two later decisions narrowed this considerably:

- [ADR-0006](0006-local-only-execution.md) — local-only, permanently. The "we might deploy later, so start on Postgres" argument is dead.
- [ADR-0008](0008-no-embeddings-lexical-retrieval.md) — no embeddings. Vector search was the strongest technical argument for Postgres, and it is no longer a requirement.

What remains is full-text search, which both engines do well.

## Options

### A. SQLite + FTS5
One file. No daemon, no Docker, no connection config. Backup is `cp`. Full-text via the built-in FTS5 virtual table joined on `job_id`. Queue via a polled table.

- **Pro:** near-zero operational cost; the whole DB is a file you can inspect, copy, and back up with any normal tool — which matters more now that local-only makes backup the user's problem
- **Pro:** tests run against a real database with no containers
- **Pro:** FTS5 is built in, no extension to install
- **Con:** single writer — fine for one worker, a wall if that ever changes
- **Con:** weaker JSON and array types; `text[]` columns become JSON blobs
- **Con:** BM25 tuning is less flexible than Postgres `ts_rank_cd`

### B. Postgres + `tsvector` (Docker)
Real server. Native arrays and JSONB. GIN-indexed full-text with configurable ranking. `pg-boss` gives a proper queue in the same database.

- **Pro:** native `text[]`, JSONB — the schema in [02-data-model](../02-data-model.md) applies as written
- **Pro:** richer full-text ranking and weighting, which stage 2 leans on more than it would have with embeddings
- **Con:** Docker must be running to do anything, including a one-line query
- **Con:** more moving parts for a single-user local tool that will never be deployed

## Decision

We will use SQLite with FTS5, in a single database file.

The two arguments that made this close are gone. There is no deployment path and no vector column. What is left is one file versus a daemon, for a tool used by one person on one machine — and the daemon cost is paid every session, before any work starts.

The counter-argument, recorded because it is the thing most likely to reverse this: stage 2 leans harder on full-text ranking than the original design did, and Postgres offers better ranking control. If lexical retrieval becomes the quality bottleneck, that is what would justify switching.

## Consequences

- `text[]` columns in [02-data-model](../02-data-model.md) become JSON arrays. Anything needing to be filtered on must be a real column, not a key inside JSON.
- Full-text is an FTS5 virtual table joined on `job_id`, not a column. Ranking uses `bm25()`.
- The queue is a polled table, not `pg-boss`. Single worker, so this is adequate.
- Backup is `cp jobs.db jobs.db.bak`. This matters more than usual — [ADR-0006](0006-local-only-execution.md) makes backup entirely the user's problem.
- Enable WAL mode. Web process and worker both hold the file open; without WAL the reader blocks on the writer.
- One writer only. If a second writer process ever appears, this decision breaks rather than degrades.
- Keep raw SQL portable — avoid SQLite-only syntax where an ANSI equivalent exists. All DB access goes through `src/db/` so the engine is swappable at one boundary.

Escape hatch: the schema is deliberately portable. Migrating to Postgres is roughly a day of work, plus rewriting the FTS queries.

## Revisit when

- The dataset passes ~100k jobs
- A second writer process appears
- Stage 2 recall is the measured bottleneck and FTS5 ranking is the limiting factor
- Embeddings come back into scope ([ADR-0008](0008-no-embeddings-lexical-retrieval.md))
