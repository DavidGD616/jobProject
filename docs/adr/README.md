# Architecture Decision Records

One file per decision. Numbered, immutable once `Accepted`.

## Index

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-storage-engine.md) | Storage engine: SQLite + FTS5 | Accepted |
| [0003](0003-typescript-single-language.md) | TypeScript as the single language | Accepted |
| [0004](0004-human-in-the-loop-submission.md) | Never auto-submit applications | Accepted |
| [0005](0005-source-selection-policy.md) | Only official APIs and public ATS boards | Accepted |
| [0006](0006-local-only-execution.md) | Local-only execution | Accepted |
| [0007](0007-llm-via-cli-subprocess.md) | LLM access via CLI subprocess, not API | Accepted |
| [0008](0008-no-embeddings-lexical-retrieval.md) | No embeddings; lexical + feature retrieval | Accepted |
| [0009](0009-local-browser-automation.md) | Local browser automation, agent-generated selectors | Accepted |
| [0010](0010-company-discovery.md) | The company list is derived, not curated | Accepted |

## Rules

- **Never edit an `Accepted` ADR** to change its decision. Write a new one that supersedes it, and mark the old one `Superseded by ADR-XXXX`.
- Fixing typos or adding clarification to an accepted ADR is fine.
- `Proposed` means the decision is not made. Anything depending on it is blocked.
- The interesting part is **Context** and **Consequences**, not the decision line. Record what was actually true at the time, including the constraints that will look obvious later.

Use `template.md` for new records, or the `adr` skill (`.agents/skills/adr/`).
