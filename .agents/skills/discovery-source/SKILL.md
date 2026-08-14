---
name: discovery-source
description: Add or fix a company discovery mechanism — bulk ATS probing, HN "Who is hiring" parsing, aggregator queries, or reverse ATS-token extraction from apply URLs. Use when the company list needs to grow, when discovery returns junk companies, when probe hit rate drops, or when the user says "find more companies", "add discovery", "coverage is too narrow".
---

# Company discovery

The company list is an **output** of this system, not an input ([ADR-0010](../../../docs/adr/0010-company-discovery.md)). The user never writes company names. If a change would require them to, it is the wrong change.

Discovery finds *companies*. Job sources find *postings* at companies already known. Different contract, different cadence — see the `job-source` skill for the other half.

## Contract

Each mechanism lives in `src/discovery/`:

```ts
discover(config)   → CandidateCompany[]   // name, ats hints, provenance
verify(candidate)  → Company | null       // probe the board; 404 → null
```

`verify` is shared, not per-mechanism. Every candidate from every source goes through the same probe before it enters `companies`.

## Why probing is cheap

ATS board endpoints are self-validating:

```
GET boards-api.greenhouse.io/v1/boards/stripe/jobs      → 200 + JSON
GET boards-api.greenhouse.io/v1/boards/notarealco/jobs  → 404
```

A wrong guess costs one HTTP request. That is the entire basis of the approach — generate many candidates, discard the misses, keep what resolves. The 200 response also carries the real company name and the current openings count, so a verified candidate arrives fully populated.

## Mechanisms

| Mechanism | Input | Notes |
|---|---|---|
| `probe` | Any list of company names | Slugify, try all ATS platforms. The seed |
| `hn-hiring` | Monthly HN thread via free Algolia API | Self-selected for actively hiring. Needs LLM parsing — unstructured prose |
| `aggregator` | Adzuna query by role + location | Finds companies outside any list you'd write |
| `reverse-url` | An aggregator listing's apply URL | Best quality. `boards.greenhouse.io/{token}/jobs/…` → token |

`reverse-url` is the one that compounds: aggregator finds a company, the token gets extracted, and from then on its whole board is read directly at Tier 1 quality.

## Slugification

Most probe misses are bad slugs, not absent companies. Try several forms per name before giving up:

```
"Acme Corp, Inc."  →  acmecorp · acme-corp · acme · acmecorpinc
```

Lowercase, strip legal suffixes (`Inc`, `Ltd`, `GmbH`, `S.L.`), strip punctuation, then try both hyphenated and concatenated. Cache negative results so the next run does not re-probe known misses.

## Manners — read this before running at scale

This is thousands of requests against three hosts, and it runs **before any other part of the system works**. Getting the IP blocked here blocks everything.

- Concurrency 1–2 **per ATS host**, not global
- Hard rate limit, and spread the seed run out rather than bursting
- Descriptive `User-Agent` with a contact address
- Back off on 429/5xx and stop the run rather than retrying into a wall
- Cache negative probes — never re-probe a known 404 on the next run

## Adding a mechanism

1. Produce `CandidateCompany[]` — name plus any ATS hint you have. Do not verify inline
2. Set `discovered_via` to your mechanism name. This is what makes junk traceable later
3. Route everything through the shared `verify`
4. Insert only verified rows. `active = true`, `tier` at its default — never guess a tier
5. Record quirks below

## Quality problems and their fixes

| Symptom | Cause | Fix |
|---|---|---|
| Junk companies appear | Recruiting agencies and staffing firms post heavily | `block_company` from the review list. Check `discovered_via` to find which mechanism produced them |
| Probe hit rate collapses | Slugification, usually — not a dead source | Log near-misses. Test the slug variants by hand against a company you know exists |
| Same company twice | Different slug on two ATS platforms, or a rename | Company alias table, matched on `slug` |
| Board returns nothing for weeks | Company left that ATS | Set `active = false`. Do not delete — it may come back |
| Discovery finds nothing new | Seed list exhausted | Add a new candidate source. This is expected after the first few runs |

## Do not

- Ask the user to name companies. That is the failure this exists to prevent
- Guess `tier`. It is optional and stays at its default unless a human sets it
- Delete inactive companies. `active = false` preserves history and stops the polling
- Conflate `active` and `blocked` — one is "the board is dead", the other is "never show me this"

## Per-mechanism quirks

Append findings here as they surface.

- _(none yet — populate during Phase 1)_
