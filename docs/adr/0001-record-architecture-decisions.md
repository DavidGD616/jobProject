# ADR-0001 — Record architecture decisions

**Status:** Accepted
**Date:** 2026-08-13

## Context

Solo project, built in bursts, with gaps between sessions. The expensive failure mode is not a wrong decision — it is re-deciding something already decided, or reversing a choice without knowing why it was made.

An AI agent works on this repo across sessions with no memory of previous reasoning. Written decisions are how that context survives.

## Decision

We will record every non-obvious architectural decision as an ADR in `docs/adr/`, numbered sequentially, immutable once accepted.

## Consequences

- Every significant choice costs ~10 minutes of writing.
- Any session — human or agent — can reconstruct why the system is shaped this way.
- Reversals become explicit: a new ADR supersedes the old, and the old stays readable.
- Risk: ADRs written for trivial decisions become noise. Bar for writing one is "someone could reasonably do this differently and the cost of switching later is real."

## Revisit when

Never. If ADRs stop being written, the project has other problems.
