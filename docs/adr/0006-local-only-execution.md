# ADR-0006 — Local-only execution

**Status:** Accepted
**Date:** 2026-08-13

## Context

This is a personal tool for one person. There is no second user, no team, no reason for it to be reachable from anywhere but the machine it runs on.

It also holds unusually sensitive material: a full resume, salary expectations, which companies are being targeted, and a record of every rejection. That is a profile of someone's career and finances in one database. Every remote component is a place that can leak.

Hosting also imposes ongoing cost — a server, a domain, TLS, secrets management, uptime — for zero benefit to a single local user.

## Decision

Everything runs on the local machine. No deployment, no hosted database, no remote worker, no cloud storage, no telemetry.

Outbound HTTPS to job boards is in scope — that is the data source and cannot be local. Nothing inbound, ever.

## Consequences

- No auth, no session handling, no multi-tenancy. Large amount of work simply does not exist.
- Binds to `127.0.0.1` only. Never `0.0.0.0`.
- Kills the "we might deploy later" argument in [ADR-0002](0002-storage-engine.md). Storage should be chosen for local ergonomics alone.
- Backup is the user's problem, and becomes a real one — a single machine failure loses the whole pipeline history. Mitigate by keeping the database a plain file that a normal backup tool already covers.
- The app is unavailable when the machine is off. Accepted — scheduled fetches catch up on next run, and job postings do not expire hourly.
- Sync across machines is out of scope. If ever needed, it is a file-sync problem, not an architecture problem.

## Revisit when

Never, unless a second user appears — which would make this a different product.
