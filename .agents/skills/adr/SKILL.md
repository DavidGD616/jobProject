---
name: adr
description: Write, accept, or supersede an Architecture Decision Record in docs/adr/. Use when a non-obvious architectural choice is being made, when the user says "write an ADR", "record this decision", "we decided X", or when a Proposed ADR needs to be accepted or reversed.
---

# ADR workflow

Decisions in this repo live in `docs/adr/`, one file per decision, numbered sequentially.

## When to write one

Write an ADR when **both** are true:

- Someone could reasonably choose differently
- Switching later has real cost

Do **not** write one for: library version bumps, formatting, naming, or anything reversible in an afternoon. Noise ADRs make the real ones unreadable.

Signals a decision needs recording: it constrains the schema, it picks a runtime or storage engine, it rules something out on legal/ToS grounds, or it establishes a policy other code must follow.

## Writing a new ADR

1. **Check for an existing one.** Read `docs/adr/README.md`. If an accepted ADR already covers this, you are superseding — see below, not writing fresh.
2. **Next number**, zero-padded to 4. Filename `NNNN-kebab-case-title.md`.
3. **Copy `docs/adr/template.md`.** Fill every section.
4. **Status starts `Proposed`** unless the user has explicitly decided. Do not mark `Accepted` on the user's behalf.
5. **Add a row to `docs/adr/README.md`.**
6. **Link it** from whichever numbered doc in `docs/` depends on it, and link back.

## Section guidance

**Context** — the highest-value section. Record what is true *right now*: constraints, available tooling, data volume, who maintains it. Include the things too obvious to write down; those are the ones nobody remembers later. A reader in six months should be able to tell whether the context still holds.

**Options** — at least two, honestly stated. An ADR with one option is not a decision, it is a note. Give real cons for the option you favour.

**Decision** — one sentence, active voice: "We will X." If status is `Proposed`, write `_Pending._` and give a recommendation with reasoning, plus the strongest counter-argument.

**Consequences** — what gets harder, not just easier. Name the escape hatch if this turns out wrong.

**Revisit when** — a concrete trigger: a scale threshold, a new requirement, a dependency change. "When it becomes a problem" is not a trigger.

## Accepting a Proposed ADR

Only when the user has actually decided.

1. `Status:` → `Accepted`, remove the "needs sign-off" note
2. Replace `_Pending._` with the decision sentence
3. Prune the Consequences section to the branch that was taken
4. Update the status in `docs/adr/README.md`
5. Update any doc that was marked blocked on it

## Superseding

**Never edit an `Accepted` ADR to change its decision.** The old reasoning is the point.

1. Write a new ADR. Its Context explains what changed since the original — that is the whole value
2. Old ADR: `Status: Superseded by ADR-NNNN`, add a link. Change nothing else
3. Update `docs/adr/README.md`

Typo fixes and added clarifications to an accepted ADR are fine.

## Style

Terse. Present tense. No hedging. This is a record of what was decided and why, not an essay. Most ADRs fit on one screen.
