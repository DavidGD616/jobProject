/**
 * Tier 1 source policy from docs/03-sources.md. Lever's published robots
 * policy asks crawlers to wait one second between requests, so the configured
 * spacing is already at that floor before the policy is fetched.
 */
export const leverSourceConfig = {
  id: "lever",
  cadenceMs: 6 * 60 * 60 * 1_000,
  maxConcurrentRequests: 2,
  minRequestIntervalMs: 1_000,
  userAgent:
    "job-hunt-agent/0.1 (+https://github.com/DavidGD616/jobProject/issues)",
} as const;
