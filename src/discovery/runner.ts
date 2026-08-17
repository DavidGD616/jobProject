import type {
  CandidateCompany,
  DiscoveryAtsType,
  ProbeResult,
  VerifiedCompany,
} from "./_contract";
import { createDiscoveryVerifier } from "./probe";
import type { DiscoveryVerifier } from "./probe";
import { discoveryProbeConfig } from "./config";

export interface BulkProbeOptions {
  verifier?: DiscoveryVerifier;
  maxCandidatesInFlight?: number;
  signal?: AbortSignal;
}

export interface BulkProbeResult {
  candidates: number;
  processed: number;
  results: ProbeResult[];
  verified: VerifiedCompany[];
  pausedAtsTypes: DiscoveryAtsType[];
}

function uniqueVerified(companies: Iterable<VerifiedCompany>): VerifiedCompany[] {
  const seen = new Set<string>();
  const unique: VerifiedCompany[] = [];
  for (const company of companies) {
    if (seen.has(company.slug)) continue;
    seen.add(company.slug);
    unique.push(company);
  }
  return unique;
}

/** Run candidates through the shared verifier with a bounded task fan-out. */
export async function runBulkProbe(
  candidates: readonly CandidateCompany[],
  options: BulkProbeOptions = {},
): Promise<BulkProbeResult> {
  // A fresh verifier makes its host circuit breakers run-scoped. The exported
  // one-off probe remains useful for callers that do not need batch behavior.
  const verifier = options.verifier ?? createDiscoveryVerifier();
  const configuredConcurrency =
    options.maxCandidatesInFlight ?? discoveryProbeConfig.maxCandidatesInFlight;
  const maxCandidatesInFlight = Number.isFinite(configuredConcurrency)
    ? Math.max(1, Math.floor(configuredConcurrency))
    : discoveryProbeConfig.maxCandidatesInFlight;
  const results = new Array<ProbeResult | undefined>(candidates.length);
  let nextIndex = 0;
  let stopped = false;

  async function worker(): Promise<void> {
    while (true) {
      if (stopped) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) return;

      const result = await verifier.probe(candidates[index]!, options.signal);
      results[index] = result;
      if (result.attempts.some((attempt) => attempt.outcome === "paused")) {
        // Current workers are allowed to finish their in-flight candidate;
        // no additional candidates are dispatched once an ATS is paused.
        stopped = true;
      }
    }
  }

  const workerCount = Math.min(maxCandidatesInFlight, candidates.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  const completedResults = results.filter(
    (result): result is ProbeResult => result !== undefined,
  );
  const pausedAtsTypes = [
    ...new Set(
      completedResults.flatMap((result) =>
        result.attempts
          .filter((attempt) => attempt.outcome === "paused")
          .map((attempt) => attempt.atsType),
      ),
    ),
  ];

  return {
    candidates: candidates.length,
    processed: completedResults.length,
    results: completedResults,
    verified: uniqueVerified(
      completedResults.flatMap((result) =>
        result.company ? [result.company] : [],
      ),
    ),
    pausedAtsTypes,
  };
}
