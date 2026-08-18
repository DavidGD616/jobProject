# 04 — Matching

**Status:** Current · **Last updated:** 2026-08-17
**Constrained by:** [ADR-0007](adr/0007-llm-via-cli-subprocess.md) (LLM via CLI) · [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md) (no embeddings) · [ADR-0011](adr/0011-profile-guided-explore-candidates.md) (profile-guided Explore)

Goal: turn a few thousand open jobs into a daily list of ~20 worth reading, each with a reason.

## Shape of the problem

Three stages, each cutting the set so the expensive stage runs on few items. The expensive stage is a CLI subprocess at 5–30s per invocation, so the funnel matters far more here than it would with a hosted API.

```
  thousands  ──stage 1: deterministic filters──▶  hundreds
                                            │
                                     stage 2: lexical + features
                                            ▼
                                          ~60
                                            │
                                     stage 3: LLM rerank (batched)
                                            ▼
                                          ~20  ranked, with reasons
```

Stages 1 and 2 need no LLM at all. If every CLI is unavailable, the list still ranks — worse, but usable.

## Explore — broad profile-guided candidates

Explore is the step before the ranking funnel, not a dump of every official
posting in the local ledger. It performs a read-only FTS query from the current
profile's skills, title aliases, aliases, and cached query terms, scans the
strongest 1,500 lexical hits, and shows the best 300 broad candidates. Its
score weights title-aware BM25, exact profile overlap, title-alias hits,
location affinity, and preferred-company affinity.

This keeps useful adjacent roles visible even when they are not a final Match.
Known location or work-setting mismatches rank lower in Explore rather than
being discarded; explicit exclusions, salary floors, and prior skip/block
decisions still remove a role. The official source snapshot remains complete
in SQLite, and `scope=all` is available only when the underlying inventory is
needed. No LLM call or database write occurs in this request path.

## Extraction happens in two tiers, not one

Stage 1 filters on salary, seniority, and remote type — fields that must be extracted before they can be filtered on. The obvious reading is "enrich every job first." At ~10,000 postings and ~10s per CLI call that is 27+ hours per run.

So extraction is split:

- **Heuristic, at ingest, on every job.** Regex and title parsing: `senior` / `jr` / `staff` in the title, `$120k–150k` and `€45.000` patterns, `remote` / `hybrid` / `on-site` keywords. Free, instant, catches most of it.
- **LLM, at stage 3, on the ~60 that get there.** Folded into the rerank call that already runs — the model is reading the description anyway. No extra invocations.

Fields already populated by a source or heuristic are retained. The current
stage-3 extraction fills only missing fields; it does not overwrite a non-null
value.

Consequence for stage 1: it filters on heuristic values, which are sometimes null. **Treat null as pass, not fail.** A job with an unparseable salary must not be silently dropped before anything has read it.

## Stage 1 — Hard filters (deterministic, free)

Non-negotiables. Binary, no scoring. The FTS corpus query is SQL; the remaining
preference checks are deterministic local code.

- Geography / remote compatibility
- Configured exclusion text (which can include work-authorization language)
- Salary floor when `salary_max` is known — unknown compensation passes
- Configured seniority values — friendly labels such as `entry level`,
  `associate`, and `mid-level` are normalized to the canonical job levels;
  an unsupported saved label remains a literal boundary rather than silently
  disabling seniority filtering; an unknown job seniority passes
- Open, active, canonical jobs only; company not blocked
- The latest `skip` or `block_company` triage decision excludes a job;
  `interested` remains visible and marked as such

The FTS query restricts the initial corpus to open jobs from active companies;
the remaining preference checks run locally before scoring. `block_company`
also marks the company blocked, so its other jobs disappear as well. A wrong
filter is invisible — the job never appears and you never learn it was dropped.
Log filter counts per run so a filter that suddenly removes 90% of everything
is noticeable.

## Stage 2 — Lexical + feature retrieval (fast, no LLM)

Two scores combined. Both come from data already in the schema.

### 2a. Full-text score

`jobs_fts` is an external-content FTS5 index over `title` and the
boilerplate-stripped `description_fts`, joined to `jobs` by `rowid = jobs.id`.
The migration backfills it and triggers keep it synchronized. Candidate ranking
uses title-weighted `bm25(jobs_fts, 8.0, 1.0)`.

The query comes from the profile: skills, title aliases, skill aliases, and
optional LLM-expanded `query_terms`. It is a parameterized OR of literal
phrases. Profile weights are preserved by a separate exact-term score over the
title, stripped description, and extracted stack; that score is a 20% lexical
tie-breaker, while normalized BM25 supplies the other 80%.

Descriptions are long and stuffed with boilerplate (benefits, EEO statements,
company blurb). Ingest strips it before indexing, or BM25 rewards whoever wrote
the longest culture section. Retrieval only backfills legacy open rows whose
`description_fts` is still `NULL`.

### 2b. Feature score

Structured, explainable, and calculated locally from extracted fields:

| Feature | Signal |
|---|---|
| Seniority proximity | Target seniority distance; unknown is neutral |
| Remote compatibility | Match against preference; unknown is neutral |
| Salary suitability | `salary_max` against the floor; unknown is neutral |
| Company tier | 1 = dream … 5 = never |
| Preferred company | A listed company receives a soft boost; an unlisted company is neutral |
| Freshness | Exponential decay from `posted_at`, or `first_seen_at` when absent |

Stack/profile overlap is part of the lexical exact-term tie-breaker, not a
separate feature score.

### 2c. Combination

BM25 is normalized to 0–1 within the FTS candidate set. The current retrieval
score is `0.6 × lexical + 0.4 × feature`; lexical is `0.8 × BM25 + 0.2 ×`
weighted exact-term score. These coefficients are currently explicit in
`src/matching/retrieve.ts`, not config. The default candidate limit is 60.

Changing skills, title aliases, or skill aliases clears cached LLM-expanded
`query_terms`; the worker regenerates them on its next `jobs:rank -- --expand`
run rather than using stale vocabulary from the old profile.

### The known weakness

No semantic matching. "Applied Scientist" will not surface for a profile written around "ML Engineer" unless the words appear. Two mitigations, per [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md):

1. **Alias lists in the profile.** Title aliases and skill aliases, maintained by hand. The synonym set for one person's target roles is small and knowable — this recovers most of the practical gap.
2. **LLM query expansion.** One CLI call turns the profile into a weighted term
   list. Its rendered prompt is cached, so changes to its query inputs produce
   a different cache entry.

Watch for the failure mode: if good jobs are consistently absent from the top 60, the problem is recall in stage 2, not ranking in stage 3. Diagnose by hand-picking known-good jobs and checking whether they survive stage 2 at all.

## Stage 3 — LLM rerank (expensive, ~60 items)

Each call explicitly requests a strict `results` object, with one per-job
scoring and extraction record. Codex runs receive the same JSON Schema natively;
local Zod validation remains the final safeguard:

```json
{
  "results": [{
    "job_id": 123,
    "score": 88,
    "reasoning": "concise and concrete",
    "gaps": ["requirement you don't meet", "..."],
    "strengths": ["specific overlap", "..."],
    "flags": ["salary below floor", "requires on-site", "..."],
    "extracted": {
      "salary_min": 70000, "salary_max": 90000, "currency": "EUR",
      "seniority": "senior", "remote_type": "remote",
      "stack": ["typescript", "postgres"]
    }
  }]
}
```

`extracted` fills null salary, currency, seniority, remote-type, and stack
fields for these candidates only. It does not replace existing source or
heuristic values. The model has already read the description to score it —
asking for missing fields costs nothing extra.

### Batching

The current default is eight jobs per invocation. Batching amortizes process
startup and lets the model make relative comparisons; callers may tune the
batch size for prompt capacity and output quality.

The upper bound is the prompt size a CLI accepts on one invocation, and the
point where output quality degrades across a long list. Tune against real
descriptions.

The current prompt caps each description at 18,000 characters; it does not yet
section-trim benefits. Any future trimming must retain requirements and
responsibilities.

### Parse ladder

Every task response is validated with its task-specific Zod schema. Codex
receives a native JSON Schema when the task has a strict object-shaped response;
Claude's JSON envelope and any text fallback use the same local parser:

1. Use provider-native schema enforcement when configured
2. Extract a fenced or balanced JSON candidate
3. Decode JSON
4. Validate with Zod
5. On failure, one repair retry with the validation error fed back
6. On second failure, record `parse_failed` in `llm_runs` and continue — **never crash the batch**

A partially-scored batch is fine. Jobs missing a score fall back to their stage 2 rank and get retried next run.

### Caching

Load-bearing, not an optimization. Key:
`(task, prompt_hash, provider, model, prompt_version)`, where `prompt_hash` is
the SHA-256 of the fully rendered prompt. Changes to profile, job, or batch
inputs that are rendered into a prompt affect the cache through that hash; they
are not separate cache-key columns.

`prompt_version` is in the key on purpose — editing a prompt must invalidate the cache, or you will compare old scores against new ones and not notice.

### Provider routing

`src/llm/router.ts` maps each task to an ordered provider chain; the current
defaults try `claude` and then `codex`.

| Task | Volume | Notes |
|---|---|---|
| Query expansion | on profile update | Produces a weighted lexical term list |
| Rerank + missing-field fill | up to the requested candidate limit | Needs judgment and returns structured scores |
| Tailoring | ~5/day | Best available; output is human-reviewed anyway |

The router tries the configured provider chain on process failure or rate limit.
Every accepted result records its provider, model, and CLI version. If strict
score comparability is required, configure one provider for the run rather than
relying on fallback.

## Feedback loop

Every triage record is append-only human feedback. Its latest decision controls
review visibility: `skip` hides that job, `block_company` also blocks the
company, and `interested` stays visible as a positive signal.

**Few-shot rerank context.** The current prompt includes up to ten recent
`interested` and ten recent `skip` records as title/decision examples.
`block_company` is a visibility action, not a few-shot label.

**Learned prior.** `pnpm jobs:learn` syncs qualifying triage and application
outcomes into `ranking_feedback`. Once there are at least six examples spanning
both classes, it fits a local logistic model over lexical, feature, retrieval,
and LLM scores, then writes `learned_score` for the profile. Ranked views prefer
`learned_score`, then `llm_score`, then retrieval score.

Cold-start still falls back to the LLM score or retrieval score; it does not
manufacture a learned model.

## Calibration

LLM scores drift toward the middle and toward optimism.

- Anchor the rubric in the prompt — state what 90 means and what 40 means, concretely
- Never present raw scores as truth in the UI. Rank order is the product; the number is a sorting key
- Spot-check monthly: hand-label 20 jobs, compare to model ranking. If precision@20 sags, the rubric or the profile drifted
- Scores from different providers are not directly comparable. `provider`,
  `model`, and `cli_version` are recorded on every accepted rerank result for
  exactly this reason

## Open questions

- Should company tier multiply the final score, or stay a separate sort dimension? Leaning separate — mixing preference into fit makes both unreadable
- Jobs with no published salary (the majority) currently pass through stage 1. Consider a learned estimate later
- Re-scoring cadence when the profile changes: full re-score is expensive at CLI latency. Probably restrict to open + untriaged jobs
- Optimal stage-3 batch size under the current 18,000-character description cap
