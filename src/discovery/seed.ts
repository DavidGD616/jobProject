import type { CandidateCompany } from "./_contract";

export interface SeedDiscoveryConfig {
  names: Iterable<string>;
  discoveredVia?: string;
}

/**
 * Turn newline-delimited names from any discovery source into candidates.
 * Comments and blank lines are ignored, and duplicate names are collapsed.
 */
export function discover(config: SeedDiscoveryConfig): CandidateCompany[] {
  const discoveredVia = config.discoveredVia ?? "probe";
  const candidates: CandidateCompany[] = [];
  const seen = new Set<string>();

  for (const rawName of config.names) {
    const name = rawName
      .replace(/^\s*#.*$/, "")
      .replace(/\s+#.*$/, "")
      .trim();
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    candidates.push({ name, discoveredVia });
  }

  return candidates;
}

export function parseCandidateNames(input: string): CandidateCompany[] {
  return discover({ names: input.split(/\r?\n/) });
}
