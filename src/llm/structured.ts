import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { llmRuns } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

import { ProviderProcessError } from "./process";
import { parseStructured } from "./parser";
import { createRouter } from "./router";
import { claudeProvider } from "./providers/claude";
import { codexProvider } from "./providers/codex";
import type {
  LlmRunStatus,
  StructuredRunOptions,
  StructuredRunResult,
} from "./types";

const defaultProviders = [claudeProvider, codexProvider] as const;

function promptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

function statusForError(cause: unknown): LlmRunStatus {
  if (cause instanceof ProviderProcessError) return cause.status;
  return "error";
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function cacheKey(input: {
  task: string;
  hash: string;
  provider: string;
  model: string;
  promptVersion: string;
}) {
  return and(
    eq(llmRuns.task, input.task),
    eq(llmRuns.promptHash, input.hash),
    eq(llmRuns.provider, input.provider),
    eq(llmRuns.model, input.model),
    eq(llmRuns.promptVersion, input.promptVersion),
  );
}

function saveRun(
  database: JobHuntDatabase,
  input: {
    task: string;
    provider: string;
    model: string;
    cliVersion: string | null;
    hash: string;
    promptVersion: string;
    rawOutput: string | null;
    parsed: unknown;
    status: LlmRunStatus;
    attempt: number;
    durationMs: number | null;
    error?: string;
    now: Date;
  },
): void {
  database
    .insert(llmRuns)
    .values({
      task: input.task,
      provider: input.provider,
      model: input.model,
      cliVersion: input.cliVersion,
      promptHash: input.hash,
      promptVersion: input.promptVersion,
      rawOutput: input.rawOutput,
      parsed: input.parsed,
      status: input.status,
      attempt: input.attempt,
      durationMs: input.durationMs,
      error: input.error ?? null,
      createdAt: input.now,
    })
    .onConflictDoUpdate({
      target: [
        llmRuns.task,
        llmRuns.promptHash,
        llmRuns.provider,
        llmRuns.model,
        llmRuns.promptVersion,
      ],
      set: {
        cliVersion: input.cliVersion,
        rawOutput: input.rawOutput,
        parsed: input.parsed,
        status: input.status,
        attempt: input.attempt,
        durationMs: input.durationMs,
        error: input.error ?? null,
        createdAt: input.now,
      },
    })
    .run();
}

/** Run one structured task with cache, one repair retry, and provider fallback. */
export async function runStructured<T>(
  options: StructuredRunOptions<T>,
): Promise<StructuredRunResult<T>> {
  const database = options.database ?? db;
  const now = options.now ?? (() => new Date());
  const hash = promptHash(options.prompt);
  const providers = options.providers ?? defaultProviders;
  const router = createRouter(providers);
  const routed = router.providersFor(options.task);
  const attempted = routed.length > 0 ? routed : providers;

  for (const provider of attempted) {
    const model = options.model ?? provider.defaultModel;
    const cached = database
      .select()
      .from(llmRuns)
      .where(cacheKey({
        task: options.task,
        hash,
        provider: provider.id,
        model,
        promptVersion: options.promptVersion,
      }))
      .get();
    if (cached?.status === "ok" && cached.parsed !== null && cached.parsed !== undefined) {
      const parsed = options.schema.safeParse(cached.parsed);
      if (parsed.success) {
        return {
          value: parsed.data,
          status: "ok",
          provider: provider.id,
          model,
          cliVersion: cached.cliVersion,
          cached: true,
        };
      }
    }

    let firstResult;
    try {
      firstResult = await provider.run(options.prompt, {
        model,
        timeoutMs: options.timeoutMs,
      });
    } catch (cause) {
      saveRun(database, {
        task: options.task,
        provider: provider.id,
        model,
        cliVersion: null,
        hash,
        promptVersion: options.promptVersion,
        rawOutput: cause instanceof ProviderProcessError ? cause.rawOutput : null,
        parsed: null,
        status: statusForError(cause),
        attempt: 1,
        durationMs: null,
        error: errorText(cause),
        now: now(),
      });
      continue;
    }

    const firstParsed = parseStructured(firstResult.text, options.schema);
    if (firstParsed.value !== null) {
      saveRun(database, {
        task: options.task,
        provider: provider.id,
        model,
        cliVersion: firstResult.cliVersion,
        hash,
        promptVersion: options.promptVersion,
        rawOutput: firstResult.raw,
        parsed: firstParsed.value,
        status: "ok",
        attempt: 1,
        durationMs: firstResult.durationMs,
        now: now(),
      });
      return {
        value: firstParsed.value,
        status: "ok",
        provider: provider.id,
        model,
        cliVersion: firstResult.cliVersion,
        cached: false,
      };
    }

    const repairPrompt = [
      "Return only valid JSON matching the requested schema.",
      `Validation error: ${firstParsed.error ?? "unknown parse error"}`,
      "Original requested task:",
      options.prompt,
      "Your previous output:",
      firstResult.text.slice(0, 20_000),
    ].join("\n\n");
    try {
      const repaired = await provider.run(repairPrompt, {
        model,
        timeoutMs: options.timeoutMs,
      });
      const repairedParsed = parseStructured(repaired.text, options.schema);
      if (repairedParsed.value !== null) {
        saveRun(database, {
          task: options.task,
          provider: provider.id,
          model,
          cliVersion: repaired.cliVersion,
          hash,
          promptVersion: options.promptVersion,
          rawOutput: repaired.raw,
          parsed: repairedParsed.value,
          status: "ok",
          attempt: 2,
          durationMs: firstResult.durationMs + repaired.durationMs,
          now: now(),
        });
        return {
          value: repairedParsed.value,
          status: "ok",
          provider: provider.id,
          model,
          cliVersion: repaired.cliVersion,
          cached: false,
        };
      }
      saveRun(database, {
        task: options.task,
        provider: provider.id,
        model,
        cliVersion: repaired.cliVersion,
        hash,
        promptVersion: options.promptVersion,
        rawOutput: repaired.raw,
        parsed: null,
        status: "parse_failed",
        attempt: 2,
        durationMs: firstResult.durationMs + repaired.durationMs,
        error: repairedParsed.error ?? firstParsed.error,
        now: now(),
      });
      return {
        value: null,
        status: "parse_failed",
        provider: provider.id,
        model,
        cliVersion: repaired.cliVersion,
        cached: false,
        error: repairedParsed.error ?? firstParsed.error,
      };
    } catch (cause) {
      saveRun(database, {
        task: options.task,
        provider: provider.id,
        model,
        cliVersion: firstResult.cliVersion,
        hash,
        promptVersion: options.promptVersion,
        rawOutput: firstResult.raw,
        parsed: null,
        status: statusForError(cause),
        attempt: 2,
        durationMs: firstResult.durationMs,
        error: errorText(cause),
        now: now(),
      });
      continue;
    }
  }

  return {
    value: null,
    status: "error",
    provider: null,
    model: null,
    cliVersion: null,
    cached: false,
    error: "all configured LLM providers failed",
  };
}
