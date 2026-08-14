---
name: job-source
description: Add or fix a job source adapter (Greenhouse, Lever, Ashby, Adzuna, etc.) that fetches postings and normalizes them into the canonical Job shape. Use when adding a new job board or ATS, when an existing adapter breaks or returns bad data, or when the user says "add source", "add company board", "ingest from X".
---

# Adding a job source

Read [docs/03-sources.md](../../../docs/03-sources.md) for the catalog and [docs/01-architecture.md](../../../docs/01-architecture.md) for the adapter contract before starting.

This skill covers sources that find **postings** at a company already in the database. For finding *companies*, use the `discovery-source` skill instead.

## Policy gate — check first

[ADR-0005](../../../docs/adr/0005-source-selection-policy.md) permits only:

- Public ATS board endpoints (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee)
- Rendered career pages where `robots.txt` allows, via local Playwright ([ADR-0009](../../../docs/adr/0009-local-browser-automation.md))
- Aggregators with an official documented API (Adzuna is the one in use)

**LinkedIn, Indeed, and Glassdoor are excluded** — no public API, automated collection prohibited by their terms, enforced with fingerprinting and IP reputation scoring, and it risks the account the user needs for the actual job hunt. Using a browser or an AI agent does not change this; the prohibition is on automated collection, not on a tool.

If asked for one of these, say so and offer the ATS-board route: most of those postings originate on a Tier 1 board and are reachable at the source, fresher and better structured.

For anything not on the permitted list, check its ToS and `robots.txt` before writing code.

## Contract

Every adapter lives in `src/sources/{name}/` and exports the same three functions:

```ts
fetch(config)   → Promise<RawPosting[]>   // network. retries, backoff, rate limit
normalize(raw)  → NormalizedPosting       // PURE. no I/O, no clock, no randomness
sourceId(raw)   → string                  // stable unique id within this source
```

`NormalizedPosting` contains only source-owned job fields. Ingest adds company,
source, identifiers, timestamps, the content hash, and deduplication state;
enrich and the staleness sweep own their later-stage fields.

`normalize` must stay pure — that is what makes it testable against recorded fixtures. Anything needing I/O belongs in `fetch` or in `enrich`.

`sourceId` must be stable across runs. Prefer the source's own id. Never hash the description — descriptions get edited and the job would re-ingest as new.

**Career-page sources implement the same contract.** Their `fetch` renders with local Playwright and applies cached selectors from `extraction_rules`; `normalize` is no different in kind. Two extra rules apply:

- **Zero extracted rows is a failure, not an empty result.** Bump `fail_count`; regenerate selectors past the threshold. A redesigned page and a company with no openings must never look the same.
- **Prefer the ATS board.** If a company is reachable both ways, use the JSON board and skip rendering entirely.

## Steps

1. **Probe the endpoint** with curl. Confirm shape, pagination, and whether descriptions come as HTML.
2. **Record a fixture** — one real response into `tests/fixtures/{source}/`. Commit it. Trim to a few representative postings; keep at least one weird one (missing salary, odd location, empty department).
3. **Implement `fetch`** — timeout, retry with exponential backoff on 429/5xx, per-source concurrency cap of 1–2, descriptive `User-Agent` with a contact address. Conditional requests where the API supports them.
4. **Implement `normalize`** — map to the source-owned portion of the canonical `Job` in [docs/02-data-model.md](../../../docs/02-data-model.md). Sanitize HTML to text and compute `title_norm` with the shared helper. Ingest computes `content_hash` after pairing the normalized posting with the company slug; do not reimplement either transformation per source.
5. **Test `normalize` against the fixture** — assert required fields are present and correctly typed. Do not snapshot the whole object; that test fails on every unrelated change and teaches you nothing.
6. **Register** in source config with its cadence and rate limit.
7. **Document quirks** in the per-source section of `docs/03-sources.md`. That section is the reason the doc exists.

## Field mapping traps

- **Descriptions arrive as HTML.** Sanitize to plain text at normalize time. Never store raw HTML — it poisons the full-text index and LLM input. Boilerplate stripping into `description_fts` happens later, in `enrich`, not here.
- **`posted_at` is often missing or is the last-updated time.** Prefer a real posting date; fall back to `first_seen_at`, and do not silently pretend it is the posting date.
- **Salary lives in free text** far more often than in a structured field. If the API gives a structured number, use it — source-supplied values are authoritative. Otherwise leave null. Heuristic extraction happens in `enrich`, and LLM correction only for the ~60 jobs that reach stage 3 rerank. Never add an LLM call here.
- **Location can be a string, an array, or a nested object**, and "Remote" often appears as a location rather than a flag. Derive `remote_type` from both fields.
- **Titles carry noise** — `(m/f/d)`, `- Remote`, req IDs, bracketed suffixes, seniority prefixes. `title_norm` strips these; the raw `title` keeps them.
- **Currency is frequently implied** by the endpoint's country, not stated in the payload.

## Fixing a broken adapter

Adapters break because the upstream payload changed.

1. Re-probe live, diff against the committed fixture — that diff is the answer
2. Update the fixture and the mapping together, in one commit
3. Note the change and its date in `docs/03-sources.md`
4. Check whether sibling adapters on the same ATS share the bug

If jobs are being ingested but wrong, the bug is in `normalize` and the fixture test should have caught it — add the missing assertion first, then fix.
