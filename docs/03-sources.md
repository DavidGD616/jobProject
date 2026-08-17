# 03 — Sources

**Status:** Draft · **Last updated:** 2026-08-14
**Policy:** [ADR-0005](adr/0005-source-selection-policy.md) (what is allowed) · [ADR-0009](adr/0009-local-browser-automation.md) (how rendered pages are read) · [ADR-0010](adr/0010-company-discovery.md) (how the company list is built)

Two kinds of source, different contracts and different cadences:

- **Job sources** find *postings* at a company we already know about. Run every 6h.
- **Discovery sources** find *companies*. Run weekly.

## Job sources

### Tier 1 — Per-company ATS boards

Public JSON endpoints published by the ATS so companies can embed their own board. No key, no scraping, structured data, highest signal. **This is the core of the system.**

| ATS | Endpoint pattern | Key | Notes |
|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | none | `content=true` returns HTML description; omit it and you get titles only |
| Lever | `api.lever.co/v0/postings/{company}?mode=json` | none | Clean JSON, includes categories |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{name}` | none | Add `?includeCompensation=true` where published |
| Workable | `apply.workable.com/api/v1/accounts/{account}/jobs` | none | Paginated |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{id}/postings` | none | Detail needs a second call per posting |
| Recruitee | `{company}.recruitee.com/api/offers/` | none | |

These endpoints are also self-validating — a real token returns 200 with JSON, anything else returns 404. That property is what makes [ADR-0010](adr/0010-company-discovery.md) discovery cheap.

Descriptions come back as HTML. Sanitize to text at normalize time — never store raw HTML.

### Tier 2 — Rendered career pages

For companies with no ATS, or a custom careers page that loads listings client-side. Local Playwright renders the page; cached selectors extract the rows ([ADR-0009](adr/0009-local-browser-automation.md)).

- Selectors are generated once by a CLI agent, stored in `extraction_rules`, then replayed deterministically
- **Zero extracted rows is a failure, not an empty result.** A redesigned page and a company with no openings must not look the same
- Slower and heavier than JSON. Lower cadence, lower priority
- `robots.txt` is checked before rendering; rate limits apply as everywhere else
- If a company is reachable through both an ATS board and a career page, **always use the ATS board**

### Tier 3 — Aggregator API

One, kept deliberately: **Adzuna** (free key, broad coverage, real salary data).

Its listings are a lower-quality copy of postings reachable at the origin. Its real value is discovery — see below. Treat its postings as a fallback, and prefer the ATS copy whenever dedup finds both.

## Discovery sources

Per [ADR-0010](adr/0010-company-discovery.md), the company list is derived. Four mechanisms, weekly:

| Mechanism | How | Yield |
|---|---|---|
| **Bulk probe** | Slugify candidate names, probe all ATS endpoints, keep the 200s | Hundreds, one-time seed |
| **HN "Who is hiring"** | Rolling monthly threads via the free Algolia API → names → probe | Initial automatic seed + dozens/month |
| **Aggregator query** | Search Adzuna by role + location, read company names off results | Companies outside any hand-written list |
| **Reverse extraction** | Pull the ATS token out of an aggregator listing's apply URL: `boards.greenhouse.io/{token}/jobs/…` | Best quality — promotes straight to Tier 1 |

Probing is the one part of the system most likely to get an IP blocked, and it runs before anything else works. Cap concurrency, rate limit hard, spread it out.

A board that stops returning jobs is marked inactive, not deleted, and stops being polled.

## Excluded

| Source | Reason |
|---|---|
| LinkedIn | No public jobs API. Automated collection prohibited by their User Agreement, enforced with browser fingerprinting, rate heuristics, and IP reputation scoring. Risks the account needed for the actual job hunt |
| Indeed | Publisher API retired for this use. Same prohibition, actively blocked |
| Glassdoor | Same |

Using a browser or an AI agent does not change this — the prohibition is on automated collection, not on a particular tool.

The practical cost is small: most postings on those platforms **originate** on a Tier 1 ATS and syndicate outward. Reading the origin gets the same job earlier, with structured salary and location instead of reformatted text.

## Rate limits and manners

These are free public endpoints. Getting blocked is self-inflicted and permanent-ish.

- Descriptive `User-Agent` with a contact address
- Per-source concurrency cap of 1–2. No parallel fan-out across a whole company list
- Conditional requests (`If-None-Match` / `If-Modified-Since`) where supported
- Cadence: Tier 1 every 6h · Tier 2 daily · Tier 3 daily · discovery weekly
- Exponential backoff on 429/5xx, and stop the run after repeated failures rather than hammering
- Stop immediately on an access-denied response (401/403/451); it is a host-level signal, not a bad company token
- Respect `robots.txt` even where you are calling an API

Discovery and source adapters load and cache
`https://<request-origin>/robots.txt` through the same limiter before their
first API request, enforce its matching
allow/disallow rules, and raise their request spacing for a stricter
`Crawl-delay`. Per [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html), a
4xx response other than 429 means the robots policy is unavailable and is
treated as no published restriction; 429, 5xx, malformed policy responses, and
network failures fail safely without making the target API request.

## Adding a source

Checklists live in the skills: `job-source` for postings, `discovery-source` for companies. Short version for a job source:

1. Record one real response into `tests/fixtures/{source}/`
2. Implement `fetch` / `normalize` / `sourceId` against `_contract.ts`
3. Unit-test `normalize` against the fixture — assert on required fields, not the whole object
4. Register in source config with its cadence and rate limit
5. Note quirks below

## Per-source quirks

Append findings here as they surface — this section is the reason the doc exists.

- **Ashby:** the public board endpoint is `GET /posting-api/job-board/{name}?includeCompensation=true`; it returns the board's current postings in one `jobs` array. `descriptionHtml` and `descriptionPlain` are both published on observed boards; the adapter sanitizes the HTML, falling back to plain text if needed. `isRemote` may be true for a `Hybrid` role, so `workplaceType` takes precedence when deriving `remote_type`. Where a board publishes it, `compensation.summaryComponents` carries structured salary amount, interval, and currency; mixed currencies or intervals remain unset rather than being conflated.
- **Greenhouse:** the public board endpoint is `GET /v1/boards/{token}/jobs?content=true`; descriptions arrive entity-encoded HTML and are decoded and reduced to plain text by the adapter. The list response includes `meta.total`, but the Job Board endpoint returns the board's current postings in one response rather than using the Harvest `page`/`per_page` pagination contract. It returns an `ETag`; the adapter sends it as `If-None-Match` on later polls and represents a 304 as `not_modified`, never an empty board. The registered Tier 1 policy runs every 6h, permits two concurrent board polls, spaces request starts by 500ms, and defers the source after a 429 for the full `Retry-After` delay.
- **Lever:** `GET /v0/postings/{company}?mode=json` returns the entire board as a bare JSON array, with an `ETag` that supports `If-None-Match` and 304 responses. A job's HTML is split across `description`, optional list sections, and `additional`; the adapter joins and sanitizes those fields. It uses `categories.allLocations` when present and `workplaceType` before location text for remote classification. Lever currently publishes `Crawl-delay: 1` in `api.lever.co/robots.txt`, so its Tier 1 policy spaces starts by one second while allowing at most two board polls.
- **Bulk probe:** `pnpm discover:seed` derives candidates from the latest 36 monthly HN hiring threads (or one reproducible `--hn-story-id`), so it never asks the user to supply company names. A 2026-08 parser-only check yielded 424 unique ATS-hinted candidates; the full ≥300 live-board exit run remains to be measured. It admits only top-level listings with an exact official Greenhouse, Lever, or Ashby URL: explicit `Company:`/`Company Name:` headings are accepted, while pipe headings must normalize to that board's token. That conservative rule prevents titles, locations, and reply text from becoming companies, while richer HN prose parsing remains deferred until the LLM harness exists. The URL supplies a single ATS/token hint; unhinted sources use compact/hyphenated/legal-suffix-stripped slugs across supported hosts. Probes check and honor each API origin's robots policy, space starts by one second per host (or a stricter published delay), cache confirmed 404s under `data/`, and write detailed attempts to `data/discovery-last-run.json`. Repeated retryable failures, invalid 2xx payloads, or access-denied responses pause the affected host, stop the batch, skip DB writes, and return a non-zero exit code. Verified boards alone are upserted into `companies`; the probe does not fetch or store job postings.
