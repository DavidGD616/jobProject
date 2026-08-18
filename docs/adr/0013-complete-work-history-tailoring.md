# ADR-0013 — Complete work-history tailoring

**Status:** Accepted
**Date:** 2026-08-18

## Context

ADR-0012 made tailoring evidence-grounded by selecting source facts that
directly matched a role. In practice, an experience entry whose bullets did
not name a target skill or title could render with no bullets at all. That
silently removes real work history and makes a truthful career look less
complete.

The user needs materials that lead with the target role and relevant evidence
without renaming an employer-issued title, changing dates, or discarding
legitimate experience. A project can also be the user's most recent or most
important work even when the saved project-array order or lexical score does
not say so. Recency and featured status must therefore be explicit profile
facts, not inferred by the tailor.

## Options

### A. Keep only directly matched experience bullets

Produces a compact, role-focused page, but can erase all visible detail from a
real role when its vocabulary differs from the job description.

### B. Retain complete work history and prioritize truthful evidence

Preserves every saved role, title, date, and bullet while ordering direct and
transferable facts first. It can make a variant longer and requires explicit
project-presentation metadata.

### C. Rewrite history freely around the target role

Can make the resume look highly targeted, but risks changing source facts or
making the target role appear to be a historical employer title.

## Decision

We will retain every saved work-history role, employer-issued title, date, and
bullet in each tailored resume; a separate target-role headline and
source-derived ordering will foreground direct and transferable evidence.

Projects may remain a focused selection, but a project marked `featured` by
the user is always included and presented before relevance-ranked projects.
Featured status and recency are never inferred from profile-array order. The
tailor may only reorder or source-derive wording from saved facts; it never
invents, deletes, or relabels historical facts.

## Consequences

- A variant explains the target role without pretending that a past role had a
  different title, and no work-history entry can render empty because its
  vocabulary is not a direct match.
- The profile's structured project data gains user-authored presentation
  metadata. Changing it invalidates affected variants just like any other
  profile fact.
- The renderer and review UI must make retained history and project order
  visible. Longer source histories can require a multi-page export.
- Evidence maps and cover letters still cite only saved, relevant facts; a
  featured project is not evidence for an unrelated requirement merely because
  it appears first.
- The escape hatch is a user-authored per-role layout or explicit omission
  control, with review, rather than automatic deletion.

## Revisit when

- Users need a deliberate per-role omission or multi-layout workflow with
  explicit approval.
- Source-derived wording changes need sentence-level review mappings beyond
  stable source ordering.
- Project chronology needs richer user-authored dates or portfolio links.
