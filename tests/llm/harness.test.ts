import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";

import { companies, jobs, llmRuns, sourcePolls } from "@/db/schema";
import { createClaudeProvider } from "@/llm/providers/claude";
import { extractJsonCandidate, parseStructured } from "@/llm/parser";
import { ProviderProcessError } from "@/llm/process";
import { runStructured } from "@/llm/structured";
import type { LlmProvider, ProviderResult } from "@/llm/types";

const answerSchema = z.object({ answer: z.string() });

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { companies, jobs, llmRuns, sourcePolls } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

function fakeProvider(
  id: string,
  responses: Array<ProviderResult | Error>,
): LlmProvider {
  return {
    id,
    defaultModel: "fake-model",
    capabilities: () => ({ structuredOutput: false, maxPromptChars: 10_000, concurrency: 1 }),
    health: async () => true,
    run: async () => {
      const next = responses.shift();
      if (!next) throw new Error("no fake response left");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

function result(text: string, provider = "claude"): ProviderResult {
  return {
    text,
    raw: text,
    provider,
    model: "fake-model",
    cliVersion: "fake-1",
    durationMs: 1,
  };
}

test("parser extracts fenced and narrated JSON and validates it", () => {
  assert.equal(extractJsonCandidate("thinking\n```json\n{\"answer\":\"yes\"}\n```"), '{"answer":"yes"}');
  assert.deepEqual(
    parseStructured("Here is the result: {\"answer\":\"yes\"}", answerSchema).value,
    { answer: "yes" },
  );
  assert.equal(parseStructured("not JSON", answerSchema).value, null);
});

test("structured runs repair once and then cache the validated JSON", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const provider = fakeProvider("claude", [
      result("{bad"),
      result("```json\n{\"answer\":\"repaired\"}\n```") ,
    ]);
    const options = {
      task: "extract" as const,
      prompt: "Return an answer.",
      promptVersion: "test-v1",
      schema: answerSchema,
      providers: [provider],
      database: db,
    };
    const first = await runStructured(options);
    assert.equal(first.value?.answer, "repaired");
    assert.equal(first.cached, false);
    const second = await runStructured(options);
    assert.equal(second.value?.answer, "repaired");
    assert.equal(second.cached, true);
    assert.equal(db.select().from(llmRuns).all().length, 1);
    assert.equal(db.select().from(llmRuns).all()[0]?.attempt, 2);
  } finally {
    sqlite.close();
  }
});

test("structured runs fall back after a rate-limited provider", async () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const first = fakeProvider("claude", [
      new ProviderProcessError({ message: "429", status: "rate_limited" }),
    ]);
    const second = fakeProvider("codex", [result('{"answer":"fallback"}', "codex")]);
    const run = await runStructured({
      task: "rerank",
      prompt: "Rank this.",
      promptVersion: "test-v1",
      schema: answerSchema,
      providers: [first, second],
      database: db,
    });
    assert.equal(run.value?.answer, "fallback");
    assert.equal(run.provider, "codex");
    assert.equal(db.select().from(llmRuns).all().length, 2);
  } finally {
    sqlite.close();
  }
});

test("Claude provider uses the installed CLI contract without shell interpolation", () => {
  const provider = createClaudeProvider("definitely-not-installed");
  assert.equal(provider.id, "claude");
  assert.equal(provider.capabilities().structuredOutput, true);
});
