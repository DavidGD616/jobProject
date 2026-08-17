import type { ZodType } from "zod";

export const llmTasks = [
  "extract",
  "rerank",
  "expand_query",
  "tailor",
] as const;

export type LlmTask = (typeof llmTasks)[number];

export type LlmRunStatus =
  | "ok"
  | "parse_failed"
  | "timeout"
  | "error"
  | "rate_limited";

export interface ProviderCapabilities {
  structuredOutput: boolean;
  maxPromptChars: number;
  concurrency: 1 | 2;
}

export interface ProviderRunOptions {
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ProviderResult {
  text: string;
  raw: string;
  provider: string;
  model: string;
  cliVersion: string | null;
  durationMs: number;
}

export interface LlmProvider {
  id: string;
  defaultModel: string;
  run(prompt: string, options?: ProviderRunOptions): Promise<ProviderResult>;
  capabilities(): ProviderCapabilities;
  health(): Promise<boolean>;
}

export interface StructuredRunOptions<T> {
  task: LlmTask;
  prompt: string;
  promptVersion: string;
  schema: ZodType<T>;
  providers?: readonly LlmProvider[];
  model?: string;
  timeoutMs?: number;
  database?: import("@/db/types").JobHuntDatabase;
  now?: () => Date;
}

export interface StructuredRunResult<T> {
  value: T | null;
  status: LlmRunStatus;
  provider: string | null;
  model: string | null;
  cliVersion: string | null;
  cached: boolean;
  error?: string;
}
