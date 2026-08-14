# ADR-0008 — No embeddings; lexical + feature retrieval instead

**Status:** Accepted
**Date:** 2026-08-13

## Context

The original matching design ([04-matching](../04-matching.md)) used vector similarity as its retrieval stage: embed the profile and every job description, rank by cosine similarity, keep the top ~100 for LLM reranking.

[ADR-0007](0007-llm-via-cli-subprocess.md) removed hosted APIs. None of the three CLIs (`claude`, `codex`, `opencode`) exposes an embedding endpoint — they are agent runners, not model APIs. That leaves only local embedding models, and running a local model is explicitly out of scope for now.

So there is no way to produce an embedding. The retrieval stage needs a different mechanism.

## Options

### A. Local embedding model (Ollama, ONNX, sentence-transformers)
Rejected by scope. Adds a model runtime, gigabytes of weights, and a second failure mode, for a stage that has a workable non-ML alternative.

### B. Lexical retrieval + structured feature scoring
Full-text search over descriptions, combined with scoring on fields already extracted into the schema.

### C. Skip retrieval, LLM-rerank everything
At 5–30s per CLI invocation, reranking thousands of jobs takes hours per run. Not viable.

## Decision

Stage 2 becomes lexical retrieval combined with structured feature scoring. No embeddings, and the `embedding` columns come out of the schema rather than sitting unused.

Composition:

- **Full-text search** over title and description, scored by BM25 (FTS5 per [ADR-0002](0002-storage-engine.md))
- **Feature score** over fields already in the schema: stack overlap, seniority distance, remote compatibility, salary band, company tier
- Weighted combination, weights in config and hand-tuned, feeding the top ~60 into LLM rerank

## Consequences

**Lost:** semantic matching. "Applied Scientist" will not surface for a profile written around "ML Engineer" unless the words appear. This is the real cost and it is not small.

**Mitigations, both cheap:**

1. **Alias lists in the profile** — title aliases and skill aliases maintained by hand. Ten minutes of writing recovers most of the practical gap, because the synonym set in one person's target roles is small and knowable.
2. **LLM query expansion** — one CLI call turns the profile into a weighted term list, cached until the profile changes. Costs a single invocation per profile version and materially widens recall.

**Gained:**

- No model runtime, no weights, no embedding dimension to migrate
- Retrieval is explainable — you can see exactly which terms matched, which vector similarity never allowed
- Retrieval runs in the database in milliseconds, and works with zero LLM availability
- One fewer thing to be wrong during Phase 2 debugging

**Schema:** `jobs.embedding` and `profile.embedding` are removed. Adding them back later is one migration and a backfill — cheap, because nothing else depends on them.

## Revisit when

- Precision@20 stalls and the failure cases are clearly vocabulary mismatch rather than bad ranking
- Local models come into scope
- The alias list grows past roughly 50 entries — at that point it is an embedding model reimplemented by hand, badly
