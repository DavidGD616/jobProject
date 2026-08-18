# ADR-0011 — Profile-guided Explore candidates

**Status:** Accepted
**Date:** 2026-08-17

## Context

Official ATS board endpoints return complete board snapshots. Persisting only
roles that match the current profile would make the missing-posting sweep treat
other real openings as closed, lose provenance, and require a network re-fetch
whenever the profile changes. At the same time, a raw Explore list of every
role from hundreds of boards is too noisy to be useful.

The saved profile provides titles, skills, aliases, locations, work settings,
and preferences that can form a broad local candidate pool. Those signals are
preferences, not a claim that every other role is invalid. In particular,
"companies you would especially like to see" must not hide all roles when none
of those companies are currently in the ledger.

## Options

### A. Persist only profile-matching postings

Reduces local rows, but corrupts complete ATS snapshots and makes profile
changes depend on re-ingestion.

### B. Keep complete snapshots and filter Explore read-only

Preserves source truth while giving Explore a bounded, profile-guided candidate
pool. It costs a local FTS query on each Explore request.

### C. Keep Explore fully unfiltered and rely only on Matches

Preserves source truth, but leaves the first browsing step dominated by roles
outside the user's search.

## Decision

We will retain complete official-board snapshots locally and make Explore
default to a broad, read-only candidate pool derived from the current profile;
the full official inventory remains an explicit alternate view.

## Consequences

- Explore scores a bounded FTS candidate set using profile terms, title hits,
  location affinity, and preferred-company affinity; it does not call an LLM or
  write during a request.
- Matches keeps its stricter retrieval and reranking workflow. Stale match rows
  from an older profile version are invisible until the local worker refreshes
  them.
- Preferred companies receive a boost instead of acting as a hard gate.
- The local database still stores roles the user does not currently see. That
  is intentional: a future profile edit can surface them without a new network
  crawl.

## Revisit when

- The 300-role candidate cap regularly omits roles users later mark as
  interesting.
- Explore's local query becomes materially slow at the current database size.
- The product gains an explicit, user-authored "only these companies" filter.
