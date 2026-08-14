# jobProject

Local-only job-hunt agent: discover companies, aggregate openings from official ATS boards, rank them against a structured profile, tailor applications, track the pipeline. LLM work runs through installed AI CLIs, not a hosted API.

**This file is canonical for every coding agent.** `CLAUDE.md` imports it. Do not duplicate its content anywhere — update it here.

**Status:** Phase 1 in progress. The scaffold, SQLite schema, source contract, and Greenhouse adapter are in place — see [docs/05-roadmap.md](docs/05-roadmap.md).

**Stack:** TypeScript on Node 24 · pnpm · SQLite + FTS5 (WAL) · Next.js · Drizzle · Playwright (Chromium only) · LLM via installed CLIs.

## Read first

- [docs/README.md](docs/README.md) — index of all planning docs
- [docs/adr/](docs/adr/) — decisions, all accepted

## Standing rules

These come from accepted ADRs. Do not work around them.

- **Never auto-submit an application.** Fill the form, stop, human clicks submit ([ADR-0004](docs/adr/0004-human-in-the-loop-submission.md))
- **No scraping LinkedIn, Indeed, or Glassdoor.** Official APIs and public ATS boards only. Using a browser or an agent does not change this ([ADR-0005](docs/adr/0005-source-selection-policy.md))
- **Everything runs locally.** No deploy, no hosted DB, bind to `127.0.0.1` only ([ADR-0006](docs/adr/0006-local-only-execution.md))
- **No LLM API keys.** All LLM calls shell out to `claude`, `codex`, or `opencode` ([ADR-0007](docs/adr/0007-llm-via-cli-subprocess.md))
- **No local model runtimes and no embeddings.** Retrieval is lexical + structured features ([ADR-0008](docs/adr/0008-no-embeddings-lexical-retrieval.md))
- **Browser automation is local Playwright.** No cloud browser service. Agent writes selectors once, script replays them ([ADR-0009](docs/adr/0009-local-browser-automation.md))
- **Never ask the user to name companies.** The list is discovered ([ADR-0010](docs/adr/0010-company-discovery.md))
- **Never fabricate resume content.** Tailoring reorders and rephrases real facts from the profile; it does not invent them
- **Record decisions as ADRs** ([ADR-0001](docs/adr/0001-record-architecture-decisions.md)) — follow `.agents/skills/adr/SKILL.md`

## Conventions

- **pnpm only.** Never `npm` or `yarn` — in docs, scripts, or instructions
- `normalize` in every source adapter is pure and I/O-free, tested against a committed fixture
- Every CLI invocation: tools disabled, empty temp `cwd`, hard timeout with kill, argv array not shell string
- Cache every LLM result on `(task, prompt_hash, provider, model, prompt_version)` — at CLI latency this is load-bearing
- Bump `prompt_version` when a prompt template changes, or stale cache hits silently corrupt results
- Never crash a batch on a parse failure — record `parse_failed`, continue, retry next run
- **Never LLM-enrich every job.** Heuristics at ingest; LLM extraction rides inside the stage 3 rerank call. Enriching all ~10k jobs is 27h per run
- Zero rows from a career page is a failure signal, not an empty result
- No LLM call in a request path. The worker writes, the UI reads, and every view renders with the result missing
- Every external call: timeout, backoff, per-source rate limit. Per-provider concurrency cap 1–2
- All DB access goes through `src/db/` so the engine stays swappable

## Workflow guides

Task-specific procedures live in `.agents/skills/*/SKILL.md` — the vendor-neutral location. `.claude/skills` is a symlink to it so Claude Code auto-loads them; opencode reads both paths natively.

They are plain markdown. **Read the relevant one before starting that kind of task**, whether or not your tool loads it automatically.

| Task | Guide |
|---|---|
| Write, accept, or supersede a decision record | `.agents/skills/adr/SKILL.md` |
| Add or fix a job source adapter (finds postings) | `.agents/skills/job-source/SKILL.md` |
| Add or fix a company discovery mechanism (finds companies) | `.agents/skills/discovery-source/SKILL.md` |
| Add or fix an AI CLI provider adapter | `.agents/skills/llm-provider/SKILL.md` |

New skills go in `.agents/skills/`, never in `.claude/`. The symlink means there is nothing to keep in sync.

## Docs hygiene

When a plan changes, update the doc in the same change. A stale doc is worse than no doc — it is the input to the next session.

Keep this file and `CLAUDE.md` in a pointer relationship, never a copy. Two files with the same rules drift, and the drift is silent.
