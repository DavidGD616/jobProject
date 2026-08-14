# ADR-0004 — Never auto-submit applications

**Status:** Accepted
**Date:** 2026-08-13

## Context

The obvious "maximal" version of this project auto-submits hundreds of applications. It is technically straightforward once form-filling works — which makes it worth writing down *why* we are not doing it, before the temptation arrives at Phase 5.

Three independent reasons:

1. **It does not work.** Recruiters and ATS platforms detect spray patterns. Volume without tailoring lowers response rate; it does not raise it. The scarce resource is attention per application, not applications.
2. **Correctness.** Application forms carry legally meaningful fields — work authorization, salary expectation, start date, demographic questions, "have you worked here before." An automated wrong answer is a misrepresentation submitted under your name and cannot be retracted.
3. **Terms of service.** Most ATS platforms prohibit automated submission. Getting flagged can affect the account you use for real applications.

## Decision

The system fills forms and then stops. A human reads the filled form and clicks submit. There will be no bulk-submit mode, no "submit all approved," no unattended run.

## Consequences

- Phase 5 caps at "fills the form correctly" — a smaller, more achievable goal.
- Throughput is bounded by human review time. That is the intended constraint, not a limitation to engineer around.
- Custom application questions get surfaced to the human rather than guessed. Better answers, and it removes the hardest part of the automation.
- The `apply` module needs an interactive browser session, not a headless one. Accepted cost.

## Revisit when

Never on the ToS and correctness grounds. If a source ever offers an *official* application-submission API with structured fields, that is a different decision and gets its own ADR.
