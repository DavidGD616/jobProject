# Docs

Planning and design docs for the job-hunt agent. Written before code on purpose.

Agent instructions are in [AGENTS.md](../AGENTS.md) at the repo root — canonical for every tool. `CLAUDE.md` is a pointer to it.

## Read in order

| Doc | Contains |
|---|---|
| [00-vision.md](00-vision.md) | Problem, scope tiers, non-goals, success metrics |
| [01-architecture.md](01-architecture.md) | Components, data flow, proposed repo layout |
| [02-data-model.md](02-data-model.md) | Tables, DDL sketch, dedup strategy |
| [03-sources.md](03-sources.md) | Job source catalog, endpoints, auth, limits |
| [04-matching.md](04-matching.md) | Ranking pipeline, scoring rubric, feedback loop |
| [05-roadmap.md](05-roadmap.md) | Phases and exit criteria |

## Constraints that shape everything

Five accepted decisions do more to determine the design than any feature does. Read them before proposing changes:

- [ADR-0006](adr/0006-local-only-execution.md) — runs only on this machine, never deployed
- [ADR-0007](adr/0007-llm-via-cli-subprocess.md) — LLM via installed CLIs (`claude`, `codex`, `opencode`), no API keys
- [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md) — no embeddings; lexical + feature retrieval instead
- [ADR-0009](adr/0009-local-browser-automation.md) — local Playwright only; agent writes selectors once, script replays them
- [ADR-0010](adr/0010-company-discovery.md) — the company list is discovered, never hand-written

## Decisions

[adr/](adr/) holds Architecture Decision Records — one file per decision, immutable once accepted.
Open decisions are marked `Proposed` and need sign-off before the phase that depends on them.

## Scratch

`research/` is for raw notes — sample API responses, endpoint probing, source evaluation.
Nothing in `research/` is authoritative. Promote findings into a numbered doc or an ADR.
