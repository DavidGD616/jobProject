# ADR-0009 — Local browser automation, with agent-generated selectors

**Status:** Accepted
**Date:** 2026-08-13

## Context

Two source shapes are not reachable by plain HTTP:

1. **Rendered career pages.** Companies with no ATS, or with a custom careers page that loads its listings client-side. A plain `fetch` returns an empty shell.
2. **Application forms** in Phase 5, which need a real browser regardless.

[ADR-0005](0005-source-selection-policy.md) already rules out sites whose terms prohibit automated access. This decision is about *how* to reach the sites that permit it, and it needs recording because there are three plausible answers and two of them are wrong for this project.

**Cloud browser services** (Browserbase and similar) were considered and rejected on facts: they are cloud-only with no self-hosting option, priced $20–99/month, and every page fetched passes through a third party's infrastructure. That breaks [ADR-0006](0006-local-only-execution.md) outright and reintroduces exactly the paid-subscription-and-key model [ADR-0007](0007-llm-via-cli-subprocess.md) exists to avoid.

**Live agent-driven browsing** — handing a browser to an AI CLI and letting it navigate and extract per run — was also considered. It works, and it is the wrong tool here: 5–30s per page, non-deterministic output, unreproducible failures, and heavy subscription usage for a task whose structure is identical every single run.

## Why Playwright and not Puppeteer

Recorded because it is a reasonable question and the answer is specific to this project's design, not a general preference.

The selector-caching scheme below stores a *description* of how to find an element and replays it weeks later against a page that re-renders on every load. Puppeteer's `ElementHandle` is a pointer to a DOM node — it goes stale on re-render and the caller handles that. Playwright's `Locator` is a description re-evaluated on every use, which is exactly the model this design needs.

Secondary reasons, all pointing the same way: auto-waiting (visible, stable, enabled) removes a whole class of flakiness on JS-rendered career pages; `getByRole` / `getByLabel` survive the UI refactors that break CSS selectors on ATS forms; `setInputFiles` handles the Phase 5 resume upload cleanly; `codegen` records interactions into code, which matters when Greenhouse, Lever, and Ashby each need their own form adapter; the trace viewer makes a silent overnight failure diagnosable.

Puppeteer's one real advantage is a lighter install when only Chromium is needed. Neutralized by installing the Chromium browser alone — we do not need Firefox or WebKit.

## Decision

Browser automation runs locally via Playwright, Chromium only. No cloud browser service.

For extraction, the AI CLI generates the extraction rules **once per site**; a deterministic script replays them on every run afterwards.

```
FIRST TIME a career page is seen
  Playwright renders it locally, dumps the DOM
  CLI agent reads the DOM once → emits selectors
    { listSelector, titleSelector, urlSelector, locationSelector, ... }
  Rules stored in extraction_rules, keyed by domain + DOM fingerprint

EVERY RUN AFTER
  Playwright renders → apply cached selectors → done
  No LLM. Milliseconds. Deterministic.

RULES STOP MATCHING (site redesigned)
  DOM fingerprint changes, or the selectors yield zero rows
  → regenerate once, log it, carry on
```

## Consequences

- One CLI call per site for its entire lifetime, not one per run and not one per job. At ~400 companies this is the difference between a viable feature and an unusable one.
- Extraction is reproducible. A wrong field is a wrong selector, inspectable and fixable, rather than a model that answered differently today.
- Self-healing: a redesigned page regenerates its own rules instead of silently returning nothing. **Zero rows must be treated as a failure signal, not an empty result** — otherwise a broken site looks identical to a company with no openings.
- Playwright adds a browser download (~100MB) and real memory cost per page. Career-page sources are therefore slower and lower priority than ATS JSON, and run on a slower cadence.
- Rendering is only for sites that permit it. `robots.txt` is checked, and rate limits apply as with any other source.
- The same Playwright dependency serves Phase 5 form filling ([ADR-0004](0004-human-in-the-loop-submission.md)), so this is not a new dependency, only an earlier one.
- ATS JSON remains strictly preferred. A company reachable through both is fetched via its ATS board, never rendered.

## Revisit when

- Selector regeneration fires often enough to be noise — that would mean the LLM is guessing rather than reading, and the prompt or the DOM dump needs work
- A career-page source proves consistently unreliable enough that dropping it beats maintaining it
