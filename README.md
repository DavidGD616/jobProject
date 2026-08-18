# Job Hunt Agent

Local-only job discovery and application workspace. The complete Phase 1–6
workflow is implemented: discovered official ATS boards, profile-aware ranking,
tracking, grounded tailoring with human-editable letters, human-reviewed form
filling, and outcome learning.

## Run locally

Requirements: Node 24 and pnpm.

```bash
pnpm install
pnpm exec playwright install chromium
pnpm db:migrate
pnpm dev
```

Open <http://127.0.0.1:3000>. The development and production scripts bind to
`127.0.0.1` by design; this project is not deployed or exposed to the network.

Useful checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Database

The local SQLite database lives at `data/jobs.sqlite` and is created by the
migrations. After changing `src/db/schema.ts`, generate and apply a new
migration:

```bash
pnpm db:generate
pnpm db:migrate
```

See [docs/README.md](docs/README.md) for the architecture and roadmap.

## Daily workflow

Discover companies and poll official ATS postings:

```bash
pnpm discover:seed
pnpm jobs:fetch
```

`pnpm discover:seed` always uses the automatic HN source. To also use the
optional Adzuna discovery scout, set `ADZUNA_APP_ID` and `ADZUNA_API_KEY` in
the local environment (with `ADZUNA_COUNTRY` defaulting to `us`). It derives
the role and location from the saved profile; it never asks for company names.
Without both credentials, the run reports that Adzuna was skipped and continues
with the independent HN source.

`pnpm jobs:fetch` only polls sources that are due, active, and not blocked. For
a local long-running worker, use `pnpm jobs:watch`; it scans for due work every
minute and remains bound to local SQLite state.

Set the structured profile at `/profile`, then build and review rankings:

```bash
pnpm jobs:rank -- --limit 100 --expand
pnpm jobs:rank -- --limit 20 --rerank
```

The optional rerank and query-expansion calls use installed `claude`/`codex`
CLIs, never a hosted API. Results are cached locally in `llm_runs`.

Initial retrieval is local FTS5/BM25 over each job's title and
boilerplate-stripped description, then combines that lexical signal with the
structured preferences. There are no embeddings or hosted search service.

## Career pages, tailoring, and apply

Companies with a cached career-page extraction rule can be rendered in local
Chromium and ingested with:

```bash
pnpm career:fetch -- --company-id <id>
```

Use `--html-file <path>` for a saved rendered snapshot or `--http` for a
static-page fallback. A zero-row extraction is recorded as a rule failure and
does not close jobs.

Track a role from its detail page or the pipeline. In `/tailor`, queue a
grounded variant, then let the local worker claim the oldest queued request:

```bash
pnpm tailor -- --next
```

For a one-off terminal run that does not use the queue:

```bash
pnpm tailor -- --job-id <id>
```

After a variant is ready, prepare and fill its review-only ATS plan:

```bash
pnpm apply:prepare -- --application-id <id>
pnpm apply:fill -- --run-id <id>
```

`--next` performs the LLM selection (when available) and attempts local
Chromium PDF rendering outside the UI request, then records the request as
completed or failed. The UI only queues work, shows its status, serves finished
exports, and lets you review or edit the cover letter. Tailoring selects and
reorders facts from the stored profile; it does not invent resume content. The
existing Harvard resume layout is preserved.

`apply:fill` opens local Chromium and fills only declared fields. It has no
submit operation; custom questions and the final Submit click always remain
human actions. The UI exposes the same workflow at `/review`, `/pipeline`,
`/tailor`, `/apply`, and `/profile`.

## Verification

```bash
pnpm test
pnpm check
pnpm build
```

The test suite covers discovery, all ATS adapters, polling and staleness,
profile retrieval/reranking, LLM caching, career extraction, tracking,
tailoring, Playwright rendering, and the no-submit apply boundary.
