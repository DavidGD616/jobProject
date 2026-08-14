# ADR-0010 — The company list is derived, not curated

**Status:** Accepted
**Date:** 2026-08-13

## Context

[ADR-0005](0005-source-selection-policy.md) makes public ATS boards the core source. Those boards are addressed **per company** — `boards-api.greenhouse.io/v1/boards/{token}/jobs` needs a token. So the fetcher needs a list of companies before it can do anything.

The original plan ([03-sources](../03-sources.md), first draft) said: "pick 100–300 companies you care about." That assumption is wrong, and it was the largest hidden flaw in the plan.

The user does not know which companies to name, and — more importantly — **should not have to**. The filtering is done by the profile: skills, location, seniority, salary floor. Company knowledge is a bonus, expressed in the optional `tier` field, not a precondition. Requiring a hand-written list makes the system's coverage a function of what the user already knows, which is exactly the limitation the project exists to remove.

The list is also self-validating in a way that makes automation easy: an ATS board endpoint returns 200 with JSON for a real company token and 404 for anything else. Candidate names can be tested cheaply and wrong guesses cost nothing.

## Decision

The company list is an output of the system, not an input. Discovery is a first-class concern with its own module, its own source type, and its own cadence.

Four mechanisms, run weekly:

| Mechanism | How | Yield |
|---|---|---|
| **Bulk probe** | Slugify candidate company names, probe all three ATS endpoints, keep the 200s | Hundreds, one-time seed |
| **HN "Who is hiring"** | Monthly thread via the free Algolia API, extract company names, probe them | Dozens/month, self-selected for actively hiring |
| **Aggregator query** | Search an aggregator by role and location, read the company names off the results | Companies outside any list you'd have written |
| **Reverse extraction** | Aggregator listings link to the real application page, which is usually an ATS URL — pull the token out of it | Highest quality; promotes directly to a Tier 1 board |

Reverse extraction closes the loop: the aggregator finds companies, the system promotes them to direct ATS boards, and coverage grows without input.

This also resolves the open question in [03-sources](../03-sources.md) about keyed aggregators. **Use one** (Adzuna — free key, broad coverage, real salary data). Its value is as a discovery scout, not as a listings source; its own listings are a lower-quality copy of data reachable at the origin.

## Consequences

- Day-zero setup is a profile file and a seeding run. No company research, no list to maintain.
- Expect ~400 live boards from a first seed, growing weekly. That is an order of magnitude more than any hand-written list, and it makes the funnel in [04-matching](../04-matching.md) real rather than aspirational.
- `tier` stays optional and defaults to neutral. Fill it in for the handful of companies you develop opinions about; ignore it otherwise.
- Probing must be polite. It is thousands of requests against three hosts — rate limit it, cap concurrency, spread it out. This is the one part of the system that could plausibly get an IP blocked, and it runs *before* anything else works.
- Discovery introduces companies nobody vetted. Some will be recruiting agencies, staffing firms, or shells posting the same role repeatedly. Dedup handles the duplicate postings; `block_company` handles the rest, and it needs to be one click from the review list.
- Boards go dead. A company that stops returning jobs is marked inactive rather than deleted, and stops being polled.
- One free API key enters the project (Adzuna). Not an LLM key, so [ADR-0007](0007-llm-via-cli-subprocess.md) is untouched, but it is a secret to keep out of git and a dependency that can change tiers. Discovery must degrade to the other three mechanisms without it.

## Revisit when

- Probe hit rate drops far enough that the seed list is the bottleneck
- The blocked-company list grows large enough to suggest discovery is mostly finding noise
- Aggregator free tiers change in a way that makes the keyed mechanism not worth its setup cost
