/**
 * Tier 1 source policy from docs/03-sources.md. The issue tracker is the
 * public contact address carried in the production User-Agent.
 */
export const greenhouseSourceConfig = {
  id: "greenhouse",
  cadenceMs: 6 * 60 * 60 * 1_000,
  maxConcurrentRequests: 2,
  minRequestIntervalMs: 500,
  userAgent:
    "job-hunt-agent/0.1 (+https://github.com/DavidGD616/jobProject/issues)",
} as const;
