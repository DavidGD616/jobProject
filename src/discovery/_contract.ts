export const discoveryAtsTypes = [
  "greenhouse",
  "lever",
  "ashby",
] as const;

export type DiscoveryAtsType = (typeof discoveryAtsTypes)[number];

/** A company name supplied by a discovery mechanism before verification. */
export interface CandidateCompany {
  name: string;
  /** Optional slug supplied by a source such as an application URL. */
  slugHint?: string;
  /** Optional ATS hint; without one, all supported ATS hosts are probed. */
  atsType?: DiscoveryAtsType;
  /** Optional exact board token supplied by a source such as reverse extraction. */
  atsToken?: string;
  discoveredVia: string;
}

/** The company fields needed to persist a verified public ATS board. */
export interface VerifiedCompany {
  name: string;
  slug: string;
  atsType: DiscoveryAtsType;
  atsToken: string;
  careersUrl: string;
  discoveredVia: string;
  jobCount: number;
}

export type ProbeAttemptOutcome =
  | "verified"
  | "not_found"
  | "cached_miss"
  | "invalid_payload"
  | "failed"
  /** The upstream host was paused after repeated retryable failures. */
  | "paused";

export interface ProbeAttempt {
  atsType: DiscoveryAtsType;
  token: string;
  url: string;
  outcome: ProbeAttemptOutcome;
  status?: number;
  jobCount?: number;
  error?: string;
}

export interface ProbeResult {
  candidate: CandidateCompany;
  company: VerifiedCompany | null;
  attempts: ProbeAttempt[];
}
