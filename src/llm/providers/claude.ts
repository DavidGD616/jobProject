import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  LlmProvider,
  ProviderCapabilities,
  ProviderResult,
  ProviderRunOptions,
} from "../types";
import { runCli } from "../process";

const execFileAsync = promisify(execFile);

function resultText(output: string): string {
  try {
    const envelope: unknown = JSON.parse(output);
    if (typeof envelope === "object" && envelope !== null && "result" in envelope) {
      const value = (envelope as { result?: unknown }).result;
      if (typeof value === "string") return value;
    }
  } catch {
    // Claude can fall back to text when a version does not support the flag.
  }
  return output;
}

export function createClaudeProvider(command = "claude"): LlmProvider {
  let versionPromise: Promise<string | null> | undefined;
  const version = async (): Promise<string | null> => {
    versionPromise ??= execFileAsync(command, ["--version"], { timeout: 3_000 })
      .then(({ stdout }) => stdout.trim().split("\n")[0] ?? null)
      .catch(() => null);
    return versionPromise;
  };
  const capabilities: ProviderCapabilities = {
    structuredOutput: true,
    maxPromptChars: 120_000,
    concurrency: 1,
  };
  return {
    id: "claude",
    defaultModel: process.env.LLM_CLAUDE_MODEL ?? "default",
    capabilities: () => capabilities,
    health: async () => (await version()) !== null,
    run: async (prompt: string, options: ProviderRunOptions = {}): Promise<ProviderResult> => {
      const model = options.model ?? process.env.LLM_CLAUDE_MODEL ?? "default";
      const invocation = await runCli(
        command,
        [
          "-p",
          prompt,
          "--output-format",
          "json",
          "--allowedTools",
          "",
          "--bare",
          "--no-session-persistence",
          ...(model === "default" ? [] : ["--model", model]),
        ],
        { timeoutMs: options.timeoutMs ?? 120_000, signal: options.signal },
      );
      return {
        text: resultText(invocation.stdout),
        raw: `${invocation.stdout}${invocation.stderr ? `\n${invocation.stderr}` : ""}`,
        provider: "claude",
        model,
        cliVersion: await version(),
        durationMs: invocation.durationMs,
      };
    },
  };
}

export const claudeProvider = createClaudeProvider();
