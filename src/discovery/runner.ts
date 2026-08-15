import type {
  CandidateCompany,
  ProbeResult,
  VerifiedCompany,
} from "./_contract";
import { probe as defaultProbe } from "./probe";
import type { DiscoveryVerifier } from "./probe";
import { discoveryProbeConfig } from "./config";

export interface BulkProbeOptions {
  verifier?: DiscoveryVerifier;
  maxCandidatesInFlight?: number;
  signal?: AbortSignal;
}

export interface BulkProbeResult {
  candidates: number;
  results: ProbeResult[];
  verified: VerifiedCompany[];
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
  const verifier = options.verifier;
  const configuredConcurrency =
    options.maxCandidatesInFlight ?? discoveryProbeConfig.maxCandidatesInFlight;
  const maxCandidatesInFlight = Number.isFinite(configuredConcurrency)
    ? Math.max(1, Math.floor(configuredConcurrency))
    : discoveryProbeConfig.maxCandidatesInFlight;
  const results = new Array<ProbeResult>(candidates.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= candidates.length) return;

      results[index] = verifier
        ? await verifier.probe(candidates[index]!, options.signal)
        : await defaultProbe(candidates[index]!, options.signal);
    }
  }

  const workerCount = Math.min(maxCandidatesInFlight, candidates.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  return {
    candidates: candidates.length,
    results,
    verified: uniqueVerified(
      results.flatMap((result) => (result.company ? [result.company] : [])),
    ),
  };
}
