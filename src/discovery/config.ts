/** Conservative defaults for the first bulk seed run. */
export const discoveryProbeConfig = {
  timeoutMs: 10_000,
  maxAttempts: 2,
  retryBaseDelayMs: 500,
  maxConsecutiveFailuresPerAts: 2,
  maxConcurrentRequestsPerAts: 1,
  // Lever's published robots policy requests a one-second crawl delay; use
  // that strictest known public-board cadence for every bulk-probe host.
  minRequestIntervalMs: 1_000,
  maxCandidatesInFlight: 8,
  userAgent:
    "job-hunt-agent/0.1 (+https://github.com/DavidGD616/jobProject/issues)",
} as const;

export const discoveryCacheVersion = 1 as const;
