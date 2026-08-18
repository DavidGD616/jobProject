# ADR-0015 — Profile-grounded target headlines

**Status:** Accepted
**Date:** 2026-08-18

## Context

[ADR-0014](0014-tailor-every-selected-role.md) requires every selected role to
receive one truthful targeted draft.
The implementation used the posting's raw title verbatim as that draft's top
headline. Posting titles can contain internal team names, acronyms, or a level
the saved profile does not support. A verbatim label is not necessarily the
clearest or strongest truthful way to present the candidate for the role.

The user wants the tailoring LLM to choose one concise target headline from
the job's actual responsibilities and the candidate's saved facts. The
headline is presentation context, not a rewrite of any historical employer
title. Local LLM calls can fail or return invalid output, so generation still
needs a deterministic, fact-safe fallback.

## Options

### A. Copy the posting title verbatim

Keeps the result simple and recognizable, but repeats internal labels and can
overstate unsupported seniority or specialty.

### B. Let the LLM freely name the target role

Can make a readable headline, but can invent a seniority level, credential, or
specialty that the saved profile does not support.

### C. Validate one LLM-proposed, profile-grounded headline with a safe fallback

Lets the material use a concise role-family label while keeping the output
traceable to the job and saved facts. It adds validation and makes a no-LLM
fallback less tailored than a successful proposal.

## Decision

For every selected role, we will generate exactly one concise target headline
by having the local LLM propose a job-and-profile-grounded role label,
validating it against saved profile facts, and deterministically selecting one
safe profile-grounded headline when the proposal is missing or invalid.

The headline is selected rather than mechanically copied from the posting; it
may coincide with the posting title only when that is the supported concise
choice. It may use transferable role-family language, but it may not invent
seniority, clearance, citizenship, credentials, years, technologies, or a
specialty unsupported by the profile. Historic employer titles, companies,
dates, and bullets remain unchanged under ADR-0013. A fit warning remains
review information and never restores a generic-resume fallback.

## Consequences

- A variant has one readable, ATS-friendly target headline that can differ
  from a long or internal posting title while remaining grounded in saved
  facts.
- The tailoring prompt, parser, validation, and deterministic fallback must
  agree on the one-headline constraint and be versioned so old material is
  regenerated rather than silently reused.
- A failed or rejected LLM proposal still yields a truthful resume, although
  its deterministic headline may be broader than a successful proposal.
- The headline never changes historical experience. Users continue to review
  all generated materials before use; a later manual target-headline control
  can replace this policy if needed.

## Revisit when

- Profile facts routinely cannot support a useful target-role label.
- Users need to save, edit, or choose among target headlines before rendering.
- Grounding review finds recurring headline overstatement or overly broad
  fallback labels.
