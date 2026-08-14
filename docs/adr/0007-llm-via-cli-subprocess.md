# ADR-0007 — LLM access via CLI subprocess, not API

**Status:** Accepted
**Date:** 2026-08-13

## Context

The pipeline needs an LLM for three tasks: field extraction from job descriptions, match reranking, and resume tailoring.

The default approach is a hosted API with a key, billed per token. Rejected for two reasons:

1. **Cost duplication.** Existing CLI tools are already installed and already paid for through their subscriptions. Adding a metered API key means paying twice for the same models.
2. **Key management.** An API key is a long-lived secret in a personal repo. The CLIs already hold their own credentials, in their own config, outside this project.

Available on this machine, all with non-interactive modes:

| CLI | Non-interactive invocation |
|---|---|
| `claude` | `claude -p <prompt>` |
| `codex` | `codex exec <prompt>` |
| `opencode` | `opencode run <message>` |

The trade is real: subprocess invocation is slower, output is not schema-enforced, and these are *agentic* tools being used for a *single-shot* task.

## Decision

All LLM access goes through a provider abstraction in `src/llm/` that shells out to an installed CLI. No hosted LLM API, no API key in this project.

## Consequences

### Latency, and what it forces

A hosted API call is ~2s. A CLI invocation is 5–30s — process start plus agent loop. At batch-10, scoring 100 candidates is 2–5 minutes.

That is fine for a scheduled batch and unacceptable on demand. It hardens an existing rule into a hard constraint: **no LLM call may sit in a request path.** The worker writes results, the UI reads them. Every LLM-dependent view must render correctly with the result missing or stale.

### Structured output is no longer guaranteed

There is no JSON-schema enforcement. `claude` can emit a JSON envelope via `--output-format json`; the others return prose. Every call needs a parse ladder:

1. Provider-native structured output where available
2. Extract fenced ` ```json ` block
3. Validate against a schema
4. On failure, one repair retry with the validation error fed back
5. On second failure, record `parse_failed` and continue — never crash the batch

This ladder is core infrastructure, not a utility. Budget for it.

### Caching becomes load-bearing

At 2s per call, caching saved money. At 30s per call it is the difference between usable and not. Cache key: `(task, content_hash, profile_version, provider, model, prompt_version)`. Descriptions do not change, so the hit rate should be high after the first run.

### Agentic drift must be suppressed

These tools can read files and run commands. Scoring a job description must not. Every invocation:

- runs with tools disabled (`claude --allowedTools ""`, and `--bare` to skip hooks, plugins, and CLAUDE.md auto-discovery)
- runs with `cwd` set to an empty temp directory
- has a hard timeout and is killed on expiry
- passes the prompt via argument or stdin, never via a file in the repo

Without this, an agentic CLI pointed at this repo will read the repo.

### Concurrency is capped

Do not fan out many processes against one subscription. Per-provider concurrency of 1–2. Providers are also rate-limited by their own plans in ways this project cannot observe — treat a rate-limit failure as expected, back off, fall through to the next provider in the chain.

### Scores are provider-specific

A score from `codex` and a score from `claude` are not comparable. `provider`, `model`, and `cli_version` are recorded on every result and are part of the cache key.

### Availability

If no CLI is installed or authenticated, LLM-dependent phases degrade rather than fail. Ingest, dedup, filters, lexical ranking, and tracking all work with zero LLM calls. This is a design requirement, not an accident.

## Open

**`opencode serve`** runs a headless HTTP server. That would remove per-call process startup, likely the largest latency component. Worth benchmarking against the subprocess path during Phase 1.5. If it wins clearly, it becomes a second adapter kind — not a replacement, since `claude` and `codex` remain subprocess-only.

## Revisit when

- A CLI's terms change to prohibit programmatic invocation
- Latency makes a whole phase unworkable even as a batch
- Parse-failure rate stays above ~5% after prompt tuning
