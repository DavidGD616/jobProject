# ADR-0014 — Tailor every selected role from truthful evidence

**Status:** Accepted
**Date:** 2026-08-18

## Context

ADR-0013 preserves complete work history and moves a target-role headline,
skills, projects, and source facts into a tailored variant. The implementation
then treated a `low` fit assessment as a reason to return the generic profile
resume. That hides the target framing precisely when a user has deliberately
selected a role and produces a confusing multi-role headline.

The user wants one clear target title per application and the strongest
truthful case from their saved experience. A gap such as an undocumented
technology, clearance, citizenship, or seniority requirement remains important
for human judgment, but it cannot authorize invention or erase useful tailoring.

## Options

### A. Gate tailored materials on the fit assessment

Avoids a potentially weak application, but produces generic material for an
explicitly selected role and conflates an evidence warning with a rendering
decision.

### B. Tailor every selected role and present gaps separately

Always gives the user a role-specific factual draft while preserving a concise
review signal for requirements that the profile does not support.

### C. Remove fit assessments

Makes the screen quieter, but hides material eligibility and evidence gaps that
the user should see before applying.

## Decision

We will tailor every selected role from saved facts, using one target-job title
at the top and complete truthful work history; fit assessments remain compact
review information and never cause a generic-resume fallback.

The worker may not claim missing skills, clearance, citizenship, years, or
seniority. It creates a grounded cover letter whenever traceable relevant
evidence exists, and may omit only prose that cannot be supported truthfully.

## Consequences

- Every selected role has a target-specific headline, summary, relevant skill
  set, project order, and prioritized factual bullets, including roles with
  substantial gaps.
- Historic employer titles, companies, dates, and saved bullets remain intact
  under ADR-0013.
- The materials UI shows a short review status and keeps evidence/gap detail
  optional, rather than treating a warning as a dead end.
- A tailored document is not proof of eligibility. Users must still decide not
  to apply when a hard requirement is genuinely disqualifying.

## Revisit when

- The product gains user-authored per-role wording or omission controls.
- A jurisdiction or employer policy requires hard eligibility gates before any
  application material may be prepared.
