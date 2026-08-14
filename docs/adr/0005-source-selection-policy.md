# ADR-0005 — Only official APIs and public ATS boards

**Status:** Accepted
**Date:** 2026-08-13

## Context

The instinct is to start with LinkedIn and Indeed — they have the most postings and the most name recognition. Both are bad foundations:

- Neither offers a public jobs API for this use case.
- Both prohibit scraping in their ToS.
- Both run aggressive bot detection, so a scraper needs continuous maintenance and breaks silently.
- Scraping risks the personal account you need for the actual job hunt. The tool would damage the thing it exists to help.

The alternative is better than it first appears. Companies publish their own openings through ATS platforms (Greenhouse, Lever, Ashby, Workable), and every one of those exposes a public JSON board endpoint so companies can embed their own listings. That data is **fresher and better structured than the aggregator copy**, because it is the origin.

## Decision

Sources are limited to (a) public ATS board endpoints, and (b) aggregators with an official documented API. No scraping of sites that prohibit it. No LinkedIn, Indeed, or Glassdoor.

## Consequences

- Coverage is company-driven: value scales with the curated company list, not with a query. Curating that list is real ongoing work — and is also the highest-signal input to the whole system.
- Data quality is much higher. Structured JSON, canonical URLs, reliable posting dates, no HTML archaeology.
- Adapters are stable. Public board APIs rarely break; scrapers break weekly.
- Aggregators (Adzuna, JSearch) fill the discovery gap — find unknown companies there, then promote them to a Tier 1 direct board.
- We will miss postings that exist *only* on excluded platforms. Accepted.

## Revisit when

A major platform ships an official, licensable jobs API. Renegotiating this is an API-terms question, not an engineering one.
