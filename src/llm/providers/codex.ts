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
    structuredOutput: true,
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
      const outputSchema = options.outputSchema;
      const schemaFile = "response.schema.json";
      const finalMessageFile = "final.json";
      const invocation = await runCli(
        command,
        [
          "exec",
          "--sandbox",
          "read-only",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          ...(outputSchema
            ? ["--output-schema", schemaFile, "--output-last-message", finalMessageFile]
            : []),
          ...(model === "default" ? [] : ["--model", model]),
          prompt,
        ],
        {
          timeoutMs: options.timeoutMs ?? 120_000,
          signal: options.signal,
          inputFiles: outputSchema
            ? [{ name: schemaFile, content: JSON.stringify(outputSchema) }]
            : undefined,
          outputFiles: outputSchema ? [finalMessageFile] : undefined,
        },
      );
      const finalMessage = outputSchema ? invocation.outputFiles[finalMessageFile] : null;
      return {
        text: finalMessage?.trim() || invocation.stdout,
        raw: `${invocation.stdout}${invocation.stderr ? `\n${invocation.stderr}` : ""}${finalMessage ? `\n[output-last-message]\n${finalMessage}` : ""}`,
        provider: "codex",
        model,
        cliVersion: await version(),
        durationMs: invocation.durationMs,
      };
    },
  };
}

export const codexProvider = createCodexProvider();
