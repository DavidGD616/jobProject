import type { LlmProvider } from "./types";
import { ProviderProcessError } from "./process";

export interface BenchmarkSample {
  id: string;
  description: string;
}

export interface ProviderBenchmark {
  provider: string;
  attempted: number;
  succeeded: number;
  failed: number;
  parseLikeFailures: number;
  totalDurationMs: number;
  averageDurationMs: number;
  errors: string[];
}

/** Run a bounded, opt-in benchmark; it never writes to the database. */
export async function benchmarkProviders(input: {
  providers: readonly LlmProvider[];
  samples: readonly BenchmarkSample[];
  timeoutMs?: number;
}): Promise<ProviderBenchmark[]> {
  const results: ProviderBenchmark[] = [];
  for (const provider of input.providers) {
    const report: ProviderBenchmark = { provider: provider.id, attempted: 0, succeeded: 0, failed: 0, parseLikeFailures: 0, totalDurationMs: 0, averageDurationMs: 0, errors: [] };
    for (const sample of input.samples) {
      report.attempted += 1;
      try {
        const result = await provider.run([
          "Return only JSON in the form {\"ok\":true}.",
          `Sample ${sample.id}:`,
          sample.description.slice(0, provider.capabilities().maxPromptChars - 200),
        ].join("\n\n"), { timeoutMs: input.timeoutMs ?? 120_000 });
        report.totalDurationMs += result.durationMs;
        if (/\{\s*[\"']?ok[\"']?\s*:\s*true/i.test(result.text)) report.succeeded += 1;
        else {
          report.failed += 1;
          report.parseLikeFailures += 1;
        }
      } catch (cause) {
        report.failed += 1;
        report.errors.push(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof ProviderProcessError && cause.status === "rate_limited") break;
      }
    }
    report.averageDurationMs = report.succeeded > 0 ? Math.round(report.totalDurationMs / report.succeeded) : 0;
    results.push(report);
  }
  return results;
}
