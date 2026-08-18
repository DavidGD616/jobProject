# 03 — Sources

**Status:** Current · **Last updated:** 2026-08-17
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
- First-seen, structurally redesigned, and repeated-zero-row pages generate rules in the worker command only. The CLI receives a capped sanitized DOM, its JSON is limited to the replay parser's `tag` or `tag.class` selector syntax, and the producing provider/model is recorded with the rule.
- A structural DOM change replaces and replays the cached rule once. After two consecutive zero-row replays, the worker regenerates and retries once; another zero remains a failure, never an empty board.
- **Zero extracted rows is a failure, not an empty result.** A redesigned page and a company with no openings must not look the same
- Slower and heavier than JSON. Lower cadence, lower priority
- `robots.txt` is checked before rendering; rate limits apply as everywhere else
- If a company is reachable through both an ATS board and a career page, **always use the ATS board**

### Tier 3 — Aggregator API

One, kept deliberately: **Adzuna** (free key, broad coverage, real salary data).

Its listings are not stored as jobs. Its value is discovery: find a company,
then verify and poll its official board — see below.

## Discovery sources

Per [ADR-0010](adr/0010-company-discovery.md), the company list is derived. Four mechanisms, weekly:

| Mechanism | How | Yield |
|---|---|---|
| **Bulk probe** | Slugify candidate names, probe all ATS endpoints, keep the 200s | Hundreds, one-time seed |
| **HN "Who is hiring"** | Rolling monthly threads via the free Algolia API → names → probe | Initial automatic seed + dozens/month |
| **Aggregator query** | Search Adzuna by saved profile role + location, read company names off results | Companies outside any hand-written list |
| **Reverse extraction** | Pull the ATS token out of an aggregator result's `redirect_url`: `boards.greenhouse.io/{token}/jobs/…` | Best quality — one direct official-board probe |

`pnpm discover:seed` combines the HN candidates with an Adzuna query when both
`ADZUNA_APP_ID` and `ADZUNA_API_KEY` are configured. The query uses a saved title
alias, headline, or experience title and its first saved location; it never
takes a company name as input. Missing credentials, a profile with no role, or
an Adzuna source failure is reported in the local run summary while HN discovery
continues. Every candidate — including a direct ATS token extracted from an
Adzuna `redirect_url` — passes through the same robots-aware, rate-limited
shared verifier before anything is upserted.

Probing is the one part of the system most likely to get an IP blocked, and it runs before anything else works. Cap concurrency, rate limit hard, spread it out.

A board with a definitive 404 or 410 response is marked inactive, not deleted,
and stops being polled. A successful empty ATS snapshot remains active and
runs the normal two-snapshot job-staleness sweep.

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
- Exponential backoff on 429/5xx, sharing each retryable cooldown across the
  source. Stop a source run after a final 429 or repeated retryable failures
  rather than hammering
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
- **Bulk probe:** `pnpm discover:seed` derives candidates from the latest 36 monthly HN hiring threads (or one reproducible `--hn-story-id`) and, when credentials are present, a saved-profile Adzuna role/location query. It never asks the user to supply company names. On 2026-08-17, the unattended HN exit run processed 424 ATS-hinted candidates and verified 322 live official boards. HN admits only top-level listings with an exact official Greenhouse, Lever, or Ashby URL: explicit `Company:`/`Company Name:` headings are accepted, while pipe headings must normalize to that board's token. That conservative rule prevents titles, locations, and reply text from becoming companies. An Adzuna `redirect_url` with an official board URL supplies one exact ATS/token hint; ordinary company results use compact/hyphenated/legal-suffix-stripped slugs across supported hosts. The Adzuna API and public boards check and honor their origin's robots policy, space starts by one second per host (or a stricter published delay), back off on retryable responses, cache confirmed ATS 404s under `data/`, and write detailed attempts to `data/discovery-last-run.json`. Repeated ATS retryable failures, invalid 2xx payloads, or access-denied responses pause the affected host, stop the batch, skip DB writes, and return a non-zero exit code. Verified boards alone are upserted into `companies`; neither discovery source stores aggregator listings as jobs.
