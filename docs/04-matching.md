# 04 — Matching

**Status:** Draft · **Last updated:** 2026-08-13
**Constrained by:** [ADR-0007](adr/0007-llm-via-cli-subprocess.md) (LLM via CLI) · [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md) (no embeddings)

Goal: turn a few thousand open jobs into a daily list of ~20 worth reading, each with a reason.

## Shape of the problem

Three stages, each cutting the set so the expensive stage runs on few items. The expensive stage is a CLI subprocess at 5–30s per invocation, so the funnel matters far more here than it would with a hosted API.

```
  thousands  ──stage 1: SQL filters──▶  hundreds
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

## Extraction happens in two tiers, not one

Stage 1 filters on salary, seniority, and remote type — fields that must be extracted before they can be filtered on. The obvious reading is "enrich every job first." At ~10,000 postings and ~10s per CLI call that is 27+ hours per run.

So extraction is split:

- **Heuristic, at ingest, on every job.** Regex and title parsing: `senior` / `jr` / `staff` in the title, `$120k–150k` and `€45.000` patterns, `remote` / `hybrid` / `on-site` keywords. Free, instant, catches most of it.
- **LLM, at stage 3, on the ~60 that get there.** Folded into the rerank call that already runs — the model is reading the description anyway. No extra invocations.

Fields the source API supplied directly are authoritative and never overwritten by either tier.

Consequence for stage 1: it filters on heuristic values, which are sometimes null. **Treat null as pass, not fail.** A job with an unparseable salary must not be silently dropped before anything has read it.

## Stage 1 — Hard filters (SQL, free)

Non-negotiables. Binary, no scoring. Runs in the database.

- Geography / remote compatibility
- Visa or work-authorization requirements
- Salary floor (when published — treat null as pass, not fail)
- Seniority band, with one level of slack in each direction
- `closed_at is null`
- Company not blocked, job not already triaged

Cuts thousands to hundreds. **A wrong filter here is invisible** — the job never appears and you never learn it was dropped. Log filter counts per run so a filter that suddenly removes 90% of everything is noticeable.

## Stage 2 — Lexical + feature retrieval (fast, no LLM)

Two scores combined. Both come from data already in the schema.

### 2a. Full-text score

FTS index over `title` and `description`, ranked by BM25.

The query comes from the profile: skills, target titles, core stack, plus their aliases. Terms are weighted — a core skill outranks a nice-to-have.

Descriptions are long and stuffed with boilerplate (benefits, EEO statements, company blurb). Strip boilerplate before indexing, or BM25 rewards whoever writes the longest culture section.

### 2b. Feature score

Structured, explainable, computed in SQL over extracted fields:

| Feature | Signal |
|---|---|
| Stack overlap | Jaccard between `jobs.stack` and profile skills |
| Seniority distance | 0 for exact, penalty per level of drift |
| Remote compatibility | Match against preference, not a filter |
| Salary band | Above floor, and how far |
| Company tier | 1 = dream … 5 = never |
| Freshness | Decay on `posted_at`; a 60-day-old posting is often already filled |

### 2c. Combination

Normalize both to 0–1, weighted sum, take top ~60. Weights live in config, hand-tuned, with their rationale written down. Do not learn them before Phase 6 — there is no data yet.

### The known weakness

No semantic matching. "Applied Scientist" will not surface for a profile written around "ML Engineer" unless the words appear. Two mitigations, per [ADR-0008](adr/0008-no-embeddings-lexical-retrieval.md):

1. **Alias lists in the profile.** Title aliases and skill aliases, maintained by hand. The synonym set for one person's target roles is small and knowable — this recovers most of the practical gap.
2. **LLM query expansion.** One CLI call turns the profile into a weighted term list. Cached until the profile changes, so it costs one invocation per profile version.

Watch for the failure mode: if good jobs are consistently absent from the top 60, the problem is recall in stage 2, not ranking in stage 3. Diagnose by hand-picking known-good jobs and checking whether they survive stage 2 at all.

## Stage 3 — LLM rerank (expensive, ~60 items)

Each call returns, per job — scoring **and** the LLM extraction tier in one response:

```json
{
  "job_id": "...",
  "score": 0-100,
  "reasoning": "two sentences, concrete",
  "gaps": ["requirement you don't meet", "..."],
  "strengths": ["specific overlap", "..."],
  "flags": ["salary below floor", "requires on-site", "..."],
  "extracted": {
    "salary_min": 70000, "salary_max": 90000, "currency": "EUR",
    "seniority": "senior", "remote_type": "remote",
    "stack": ["typescript", "postgres"]
  }
}
```

`extracted` corrects whatever the heuristics guessed wrong, for these ~60 jobs only. The model has already read the description to score it — asking for the fields costs nothing extra.

### Batching

Batch 8–12 jobs per invocation. Two reasons: process startup is amortized, and relative comparison across a batch produces better-calibrated scores than isolated scoring.

Upper bound is the prompt size a CLI accepts on one invocation, and the point where output quality degrades across a long list. Tune during Phase 1.5 with real descriptions.

Send a trimmed description — requirements and responsibilities, not the benefits section. Cheaper and more accurate.

### Parse ladder

No schema enforcement is available. Every call goes through:

1. Provider-native structured output where available (`claude --output-format json`)
2. Extract fenced ` ```json ` block
3. Validate against the schema
4. On failure, one repair retry with the validation error fed back
5. On second failure, record `parse_failed` in `llm_runs` and continue — **never crash the batch**

A partially-scored batch is fine. Jobs missing a score fall back to their stage 2 rank and get retried next run.

### Caching

Load-bearing, not an optimization. Key: `(task, content_hash, profile_version, provider, model, prompt_version)`.

`prompt_version` is in the key on purpose — editing a prompt must invalidate the cache, or you will compare old scores against new ones and not notice.

### Provider routing

Config maps task → provider, with a fallback chain on failure or rate limit.

| Task | Volume | Notes |
|---|---|---|
| Field extraction | high | Cheapest available provider; the task is shallow |
| Rerank | ~60/day | Needs judgment. Keep one provider fixed for comparability |
| Tailoring | ~5/day | Best available; output is human-reviewed anyway |

Keep the rerank provider stable across a run. Mixing providers inside one ranked list produces scores that cannot be compared, which is worse than a slower run.

## Feedback loop

Every triage decision is a label.

**Phase 1 — few-shot.** Put ~20 recent labelled examples (10 interested, 10 skip, title + one-line summary) in the rerank prompt. Effective immediately, no training. Costs prompt size, which matters more here than with an API — watch the batch size trade.

**Phase 2 — learned prior.** Once there are a few hundred labels, fit something simple: logistic regression over the same structured features stage 2 already computes. Blend with the LLM score. Small dataset, so a simple model on good features wins.

Do not skip to Phase 2. Cold-start with no labels makes any classifier worse than the LLM alone.

## Calibration

LLM scores drift toward the middle and toward optimism.

- Anchor the rubric in the prompt — state what 90 means and what 40 means, concretely
- Never present raw scores as truth in the UI. Rank order is the product; the number is a sorting key
- Spot-check monthly: hand-label 20 jobs, compare to model ranking. If precision@20 sags, the rubric or the profile drifted
- Scores from different providers are not comparable. `provider` and `model` are recorded on every row for exactly this reason

## Open questions

- Should company tier multiply the final score, or stay a separate sort dimension? Leaning separate — mixing preference into fit makes both unreadable
- Jobs with no published salary (the majority) currently pass through stage 1. Consider a learned estimate later
- Re-scoring cadence when the profile changes: full re-score is expensive at CLI latency. Probably restrict to open + untriaged jobs
- Optimal batch size for stage 3 — unknown until measured in Phase 1.5
