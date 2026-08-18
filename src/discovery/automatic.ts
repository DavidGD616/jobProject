import type { CandidateCompany } from "./_contract";
import {
  discoverHnHiring,
  type HnHiringDiscoverOptions,
} from "./hn-hiring";
import { searchAdzuna, type AdzunaSearchOptions } from "./adzuna";

/** The profile fields discovery may use to form a role/location search. */
export interface DiscoveryProfile {
  titleAliases: readonly string[];
  resumeJson: {
    headline?: string;
    location?: string;
    experience?: ReadonlyArray<{ title: string }>;
  };
  preferences: { locations?: readonly string[] };
}

export interface AdzunaCredentials {
  appId: string;
  apiKey: string;
}

export type AdzunaDiscoveryStatus =
  | {
    status: "used";
    candidates: number;
    country: string;
    query: string;
    location?: string;
  }
  | { status: "skipped_missing_credentials"; candidates: 0 }
  | { status: "skipped_missing_profile_query"; candidates: 0 }
  | { status: "failed"; candidates: 0 };

export interface AutomaticDiscoveryResult {
  candidates: CandidateCompany[];
  sources: {
    hnHiring: { candidates: number };
    adzuna: AdzunaDiscoveryStatus;
  };
}

export interface AutomaticDiscoveryOptions {
  hnStoryId?: string;
  profile?: DiscoveryProfile | null;
  environment?: Readonly<Record<string, string | undefined>>;
}

export interface AutomaticDiscoveryDependencies {
  discoverHnHiring?: (
    options: HnHiringDiscoverOptions,
  ) => Promise<CandidateCompany[]>;
  searchAdzuna?: (options: AdzunaSearchOptions) => Promise<CandidateCompany[]>;
}

function configuredValue(
  environment: Readonly<Record<string, string | undefined>>,
  key: string,
): string | undefined {
  const value = environment[key]?.trim();
  return value || undefined;
}

/** Read optional Adzuna credentials without exposing their values. */
export function adzunaCredentials(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AdzunaCredentials | null {
  const appId = configuredValue(environment, "ADZUNA_APP_ID");
  const apiKey = configuredValue(environment, "ADZUNA_API_KEY");
  return appId && apiKey ? { appId, apiKey } : null;
}

function firstNonEmpty(values: Iterable<string | undefined>): string | undefined {
  for (const value of values) {
    const clean = value?.trim();
    if (clean) return clean;
  }
  return undefined;
}

/**
 * Build the optional aggregator query only from a saved profile. Company names
 * are deliberately not an input to this mechanism.
 */
export function adzunaSearchFromProfile(
  profile: DiscoveryProfile | null | undefined,
): Pick<AdzunaSearchOptions, "query" | "location"> | null {
  if (!profile) return null;
  const query = firstNonEmpty([
    ...profile.titleAliases,
    profile.resumeJson.headline,
    ...(profile.resumeJson.experience ?? []).map((experience) => experience.title),
  ]);
  if (!query) return null;
  const location = firstNonEmpty([
    ...(profile.preferences.locations ?? []),
    profile.resumeJson.location,
  ]);
  return location ? { query, location } : { query };
}

function normalizedName(candidate: CandidateCompany): string {
  return candidate.name.trim().toLocaleLowerCase();
}

function candidateKey(candidate: CandidateCompany): string {
  if (candidate.atsType && candidate.atsToken) {
    return `ats:${candidate.atsType}:${candidate.atsToken.toLocaleLowerCase()}`;
  }
  return `name:${normalizedName(candidate)}`;
}

/** Collapse duplicate candidates before they enter the shared verifier. */
export function mergeAutomaticCandidates(
  sources: ReadonlyArray<readonly CandidateCompany[]>,
): CandidateCompany[] {
  const seen = new Set<string>();
  const merged: CandidateCompany[] = [];
  for (const source of sources) {
    for (const candidate of source) {
      const key = candidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
    }
  }
  return merged;
}

function countryFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const configured = configuredValue(environment, "ADZUNA_COUNTRY") ?? "us";
  return /^[a-z]{2}$/i.test(configured) ? configured.toLowerCase() : "us";
}

/**
 * Discover candidates from the unkeyed HN source and, when configured, the
 * profile-driven Adzuna source. Both outputs remain candidates: callers must
 * pass them to runBulkProbe before persisting anything.
 */
export async function discoverAutomaticCandidates(
  options: AutomaticDiscoveryOptions = {},
  dependencies: AutomaticDiscoveryDependencies = {},
): Promise<AutomaticDiscoveryResult> {
  const discoverHn = dependencies.discoverHnHiring ?? discoverHnHiring;
  const adzunaSearch = dependencies.searchAdzuna ?? searchAdzuna;
  const environment = options.environment ?? process.env;
  const credentials = adzunaCredentials(environment);
  const search = adzunaSearchFromProfile(options.profile);

  const hnHiring = await discoverHn({ storyId: options.hnStoryId });

  if (!credentials) {
    return {
      candidates: mergeAutomaticCandidates([hnHiring]),
      sources: {
        hnHiring: { candidates: hnHiring.length },
        adzuna: { status: "skipped_missing_credentials", candidates: 0 },
      },
    };
  }

  if (!search) {
    return {
      candidates: mergeAutomaticCandidates([hnHiring]),
      sources: {
        hnHiring: { candidates: hnHiring.length },
        adzuna: { status: "skipped_missing_profile_query", candidates: 0 },
      },
    };
  }

  const country = countryFromEnvironment(environment);
  try {
    const adzuna = await adzunaSearch({
      ...credentials,
      ...search,
      country,
    });
    return {
      candidates: mergeAutomaticCandidates([hnHiring, adzuna]),
      sources: {
        hnHiring: { candidates: hnHiring.length },
        adzuna: {
          status: "used",
          candidates: adzuna.length,
          country,
          ...search,
        },
      },
    };
  } catch {
    // Adzuna is optional. Its failure must not turn off the independent HN
    // seed source, and the result deliberately avoids serializing any secret.
    return {
      candidates: mergeAutomaticCandidates([hnHiring]),
      sources: {
        hnHiring: { candidates: hnHiring.length },
        adzuna: { status: "failed", candidates: 0 },
      },
    };
  }
}
