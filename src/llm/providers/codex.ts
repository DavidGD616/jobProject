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

export function createCodexProvider(command = "codex"): LlmProvider {
  let versionPromise: Promise<string | null> | undefined;
  const version = async (): Promise<string | null> => {
    versionPromise ??= execFileAsync(command, ["--version"], { timeout: 3_000 })
      .then(({ stdout }) => stdout.trim().split("\n")[0] ?? null)
      .catch(() => null);
    return versionPromise;
  };
  const capabilities: ProviderCapabilities = {
    structuredOutput: false,
    maxPromptChars: 80_000,
    concurrency: 1,
  };
  return {
    id: "codex",
    defaultModel: process.env.LLM_CODEX_MODEL ?? "default",
    capabilities: () => capabilities,
    health: async () => (await version()) !== null,
    run: async (prompt: string, options: ProviderRunOptions = {}): Promise<ProviderResult> => {
      const model = options.model ?? process.env.LLM_CODEX_MODEL ?? "default";
      const invocation = await runCli(
        command,
        [
          "exec",
          "--sandbox",
          "read-only",
          "--ask-for-approval",
          "never",
          "--no-alt-screen",
          ...(model === "default" ? [] : ["--model", model]),
          prompt,
        ],
        { timeoutMs: options.timeoutMs ?? 120_000, signal: options.signal },
      );
      return {
        text: invocation.stdout,
        raw: `${invocation.stdout}${invocation.stderr ? `\n${invocation.stderr}` : ""}`,
        provider: "codex",
        model,
        cliVersion: await version(),
        durationMs: invocation.durationMs,
      };
    },
  };
}

export const codexProvider = createCodexProvider();
