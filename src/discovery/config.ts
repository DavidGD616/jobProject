/** Conservative defaults for the first bulk seed run. */
export const discoveryProbeConfig = {
  timeoutMs: 10_000,
  maxAttempts: 2,
  retryBaseDelayMs: 500,
  maxConcurrentRequestsPerAts: 1,
  minRequestIntervalMs: 500,
  maxCandidatesInFlight: 8,
  userAgent:
    "job-hunt-agent/0.1 (+https://github.com/DavidGD616/jobProject/issues)",
} as const;

export const discoveryCacheVersion = 1 as const;
