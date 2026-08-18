# ADR-0012 — Evidence-grounded application tailoring

**Status:** Accepted
**Date:** 2026-08-18

## Context

The first tailoring implementation only reordered stored bullets. It left the
headline, summary, project selection, and skill list largely unchanged, and
its cover-letter template did not receive the job description. This made
material sets look generic and could connect an unrelated work bullet to a
role. A variant also gave no durable explanation of which candidate facts
supported its claims or whether profile/job changes made it stale.

The workspace must improve role-specific materials without fabricating work
history, technologies, metrics, clearance, or qualifications. LLM calls stay
in the local worker and every generated artifact remains human-reviewed before
use.

## Options

### A. Continue bullet-only reordering

Keeps implementation small and deterministic, but cannot create a useful
role-specific headline, summary, project focus, or job-aware letter.

### B. Let the LLM freely rewrite the resume and letter

Can produce more variation, but loses traceability and makes unsupported
claims too easy to introduce.

### C. Generate an evidence-grounded tailoring plan

Use deterministic retrieval plus an optional structured CLI response to select
candidate facts. Create a target-role headline, summary, focused projects and
skills, and a cover letter only from that selected evidence. Persist the
evidence map, fit/gap assessment, profile version, job content hash, and
prompt version with the variant.

## Decision

We will generate each material set from a persisted, evidence-grounded
tailoring plan and visibly warn when key role requirements lack saved support.

Historical employer titles, dates, accomplishments, technologies, metrics,
and credentials remain immutable source facts. A target role may appear in the
resume headline; it is never substituted for a past job title. The worker
selects and reframes saved facts rather than accepting free-form LLM prose.
The warning is advisory: the user remains the final reviewer and may choose
whether to apply.

## Consequences

- Variants become meaningfully role-specific while preserving factual source
  material and a reviewable explanation of every selection.
- The local worker may use a structured CLI response to refine a deterministic
  fallback; UI requests remain LLM-free.
- Application checklist snapshots can be labelled stale after a changed
  variant, profile, cover letter, or job description instead of silently
  looking current.
- The schema retains extra provenance and the tailor prompt must be versioned.
  Older variants lack it and are treated as legacy/stale until regenerated.
- Evidence linking increases implementation and test surface. The escape hatch
  is to retain the stored resume/letter while regenerating only the evidence
  plan for a new prompt version.

## Revisit when

- Users need to author reusable per-role material strategies beyond one resume
  variant per job.
- Grounding review finds recurring false claims despite source selection.
- Project evidence needs richer structured fields than descriptions and
  user-authored bullets.
