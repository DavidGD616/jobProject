---
name: llm-provider
description: Add or fix an LLM provider adapter that shells out to an installed AI CLI (claude, codex, opencode). Use when wiring a new CLI into src/llm/, when a provider returns unparseable output, hangs, or hits rate limits, or when the user says "add provider", "use X CLI", "the LLM step is failing".
---

# LLM provider adapters

All LLM access in this project goes through an installed CLI, never a hosted API ([ADR-0007](../../../docs/adr/0007-llm-via-cli-subprocess.md)). Read that ADR and [docs/04-matching.md](../../../docs/04-matching.md) before changing anything here.

## Hard rules

- **No API keys.** Credentials live in each CLI's own config, outside this project. If a change introduces `ANTHROPIC_API_KEY` or similar, it is wrong.
- **No local model runtimes.** No Ollama, no ONNX weights, no embedding models. Out of scope.
- **Callers name a task, not a provider.** `extract`, `rerank`, `expand_query`, `tailor`. Routing config maps task → provider with a fallback chain.

## Contract

Each adapter in `src/llm/providers/{name}.ts`:

```ts
run(prompt, opts)  → { text, raw, provider, model, cliVersion, durationMs }
capabilities()     → { structuredOutput, maxPromptChars, concurrency }
health()           → boolean          // installed and authenticated?
```

Installed on this machine:

| Provider | Non-interactive form | Structured output |
|---|---|---|
| `claude` | `claude -p <prompt>` | `--output-format json` envelope |
| `codex` | `codex exec <prompt>` | prose |
| `opencode` | `opencode run <message>` | prose |

Flags drift between CLI versions. Confirm against `--help` before trusting any invocation here, and record what you find in the quirks section below.

## Sandboxing — do this before anything else

These are agentic tools. Pointed at this repo with tools enabled, they will read this repo, and a "score this job description" call becomes something else entirely.

Every invocation:

- **Tools disabled.** For `claude`, `--allowedTools ""` plus `--bare` (skips hooks, plugins, and CLAUDE.md auto-discovery — also makes runs deterministic). Find the equivalent for each CLI before shipping its adapter.
- **`cwd` = a fresh empty temp directory.** Never the repo root.
- **Hard timeout with kill.** A hung CLI must not wedge the worker. Kill the process group, not just the child.
- **Prompt via argument or stdin.** Never write a prompt file into the repo.
- **No shell interpolation.** Spawn with an argv array. Job descriptions contain backticks, quotes, and `$`.

## Parse ladder

No schema enforcement exists. Every call goes through, in order:

1. Provider-native structured output where available
2. Extract fenced ` ```json ` block from the text
3. Validate against the zod schema for that task
4. On failure: **one** repair retry, feeding the validation error back in
5. On second failure: write `status = 'parse_failed'` to `llm_runs`, return null, **continue**

Never crash a batch on one bad item. A partially-scored batch is a normal outcome — unscored jobs fall back to their retrieval rank and get retried next run.

Always persist `raw_output`, including on failure. Prose parse failures cannot be reproduced from the parsed value, because there isn't one.

## Caching

Every call checks `llm_runs` first. Key:

```
(task, prompt_hash, provider, model, prompt_version)
```

`prompt_version` must be bumped whenever a prompt template changes. Forgetting this means comparing scores produced by two different prompts and not knowing it.

At 5–30s per invocation, a cache miss that should have been a hit is the most expensive bug in this layer.

## Adding a provider

1. `<cli> --help` — find the non-interactive subcommand or flag. Record the exact form.
2. Find how to disable tools and any project-context auto-loading.
3. Check for a structured-output flag. If present, use it; do not skip to prose parsing.
4. Run one real prompt by hand. Look at the raw output — some CLIs prepend banners, spinners, or ANSI codes that must be stripped before parsing.
5. Implement the contract. Strip ANSI, trim banners, capture stderr separately.
6. Detect rate limiting from exit code and stderr. Map to `status = 'rate_limited'` so routing can fall through instead of retrying into a wall.
7. Add to routing config with a concurrency cap of 1–2.
8. Bench: latency, parse-failure rate, and usable batch size across ~20 real job descriptions.
9. Record quirks below.

## Debugging a failing provider

| Symptom | Look at |
|---|---|
| Parse failures | `llm_runs.raw_output`. Usually a banner, ANSI codes, or the model narrating before the JSON |
| Hangs | Missing timeout, or the CLI waiting on interactive input — check for a prompt on stderr |
| Sudden empty output | Auth expired. `health()` should catch this; if it did not, fix `health()` |
| Wrong or hallucinated fields | Tools were not disabled and the CLI went looking for context |
| Rate limits | Concurrency cap too high, or no backoff between batches |
| Scores shifted with no code change | Prompt edited without bumping `prompt_version`, so half the results came from cache |

## Per-provider quirks

Append findings here as they surface. This section is the reason the skill exists.

- _(none yet — populate during Phase 1.5)_
