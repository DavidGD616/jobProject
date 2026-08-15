import { z } from "zod";

import { createSourceRequestLimiter, delay } from "../sources/rate-limit";
import type { SourceRequestLimiter } from "../sources/rate-limit";
import { fetchRobotsPolicy } from "../sources/robots";
import type { RobotsPolicy } from "../sources/robots";
import { createNegativeProbeCache } from "./cache";
import type { NegativeProbeCache } from "./cache";
import { discoveryProbeConfig } from "./config";
import type {
  CandidateCompany,
  DiscoveryAtsType,
  ProbeAttempt,
  ProbeResult,
  VerifiedCompany,
} from "./_contract";
import { discoveryAtsTypes } from "./_contract";
import { companySlug, slugVariants } from "./slugify";

const MAX_TIMEOUT_MS = 2_147_483_647;
const GREENHOUSE_URL = "https://boards-api.greenhouse.io/v1/boards";
const LEVER_URL = "https://api.lever.co/v0/postings";
const ASHBY_URL = "https://api.ashbyhq.com/posting-api/job-board";

const greenhousePayloadSchema = z.object({
  jobs: z.array(z.unknown()),
});
const leverPayloadSchema = z.array(z.unknown());
const ashbyPayloadSchema = z.object({
  jobs: z.array(z.unknown()),
});

interface ProbePayload {
  jobCount: number;
}

interface EndpointDefinition {
  buildUrl(token: string): string;
  careersUrl(token: string): string;
  parse(payload: unknown): ProbePayload | null;
}

const endpointDefinitions: Record<DiscoveryAtsType, EndpointDefinition> = {
  greenhouse: {
    buildUrl: (token) =>
      `${GREENHOUSE_URL}/${encodeURIComponent(token)}/jobs`,
    careersUrl: (token) => `https://boards.greenhouse.io/${token}`,
    parse(payload) {
      const parsed = greenhousePayloadSchema.safeParse(payload);
      return parsed.success ? { jobCount: parsed.data.jobs.length } : null;
    },
  },
  lever: {
    buildUrl: (token) =>
      `${LEVER_URL}/${encodeURIComponent(token)}?mode=json`,
    careersUrl: (token) => `https://jobs.lever.co/${token}`,
    parse(payload) {
      const parsed = leverPayloadSchema.safeParse(payload);
      return parsed.success ? { jobCount: parsed.data.length } : null;
    },
  },
  ashby: {
    buildUrl: (token) =>
      `${ASHBY_URL}/${encodeURIComponent(token)}`,
    careersUrl: (token) => `https://jobs.ashbyhq.com/${token}`,
    parse(payload) {
      const parsed = ashbyPayloadSchema.safeParse(payload);
      return parsed.success ? { jobCount: parsed.data.jobs.length } : null;
    },
  },
};

export interface DiscoveryProbeConfig {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  maxConsecutiveFailuresPerAts: number;
  maxConcurrentRequestsPerAts: number;
  minRequestIntervalMs: number;
  userAgent: string;
}

export interface DiscoveryProbeDependencies {
  fetchImpl?: typeof globalThis.fetch;
  sleep?: typeof delay;
  now?: () => number;
  negativeCache?: NegativeProbeCache;
  limiters?: Partial<Record<DiscoveryAtsType, SourceRequestLimiter>>;
  /** Injectable policy for deterministic tests or a pre-approved source. */
  robotsPolicy?: RobotsPolicy;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function blockedStatus(status: number): boolean {
  // These are not bad candidate tokens; they indicate that the public host is
  // refusing this client or that access is legally unavailable. Retrying a
  // seed after either response is exactly the behavior the limiter exists to
  // prevent.
  return status === 401 || status === 403 || status === 451;
}

function retryAfterMs(value: string | null, now: () => number): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - now());
}

function backoffMs(baseDelayMs: number, attempt: number): number {
  return Math.min(
    Math.max(0, baseDelayMs) * 2 ** (attempt - 1),
    8_000,
  );
}

function requestSignal(config: DiscoveryProbeConfig, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function normalizedConfig(
  overrides: Partial<DiscoveryProbeConfig>,
): DiscoveryProbeConfig {
  const config = {
    ...discoveryProbeConfig,
    ...overrides,
  };

  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 0 ||
    config.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new RangeError("timeoutMs must be an integer within Node's timer range");
  }
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
  if (
    !Number.isFinite(config.retryBaseDelayMs) ||
    config.retryBaseDelayMs < 0
  ) {
    throw new RangeError("retryBaseDelayMs must be finite and non-negative");
  }
  if (
    !Number.isInteger(config.maxConsecutiveFailuresPerAts) ||
    config.maxConsecutiveFailuresPerAts < 1
  ) {
    throw new RangeError(
      "maxConsecutiveFailuresPerAts must be a positive integer",
    );
  }
  if (
    !Number.isInteger(config.maxConcurrentRequestsPerAts) ||
    config.maxConcurrentRequestsPerAts < 1
  ) {
    throw new RangeError(
      "maxConcurrentRequestsPerAts must be a positive integer",
    );
  }
  if (
    !Number.isFinite(config.minRequestIntervalMs) ||
    config.minRequestIntervalMs < 0
  ) {
    throw new RangeError("minRequestIntervalMs must be finite and non-negative");
  }
  if (!config.userAgent.trim()) {
    throw new RangeError("userAgent must not be empty");
  }

  return config;
}

function atsOrder(candidate: CandidateCompany): DiscoveryAtsType[] {
  return candidate.atsType ? [candidate.atsType] : [...discoveryAtsTypes];
}

function candidateTokens(candidate: CandidateCompany): string[] {
  if (candidate.atsToken?.trim()) return [candidate.atsToken.trim()];
  return slugVariants(candidate.slugHint ?? candidate.name);
}

function cacheKey(atsType: DiscoveryAtsType, token: string): string {
  return `${atsType}:${token}`;
}

interface AtsCircuit {
  isOpen(): boolean;
  pause(): void;
  recordFailure(): boolean;
  recordHealthyResponse(): void;
}

function createAtsCircuit(maxConsecutiveFailures: number): AtsCircuit {
  let consecutiveFailures = 0;

  return {
    isOpen() {
      return consecutiveFailures >= maxConsecutiveFailures;
    },
    pause() {
      consecutiveFailures = maxConsecutiveFailures;
    },
    recordFailure() {
      consecutiveFailures += 1;
      return consecutiveFailures >= maxConsecutiveFailures;
    },
    recordHealthyResponse() {
      consecutiveFailures = 0;
    },
  };
}

interface ProbeBoardOptions {
  atsType: DiscoveryAtsType;
  token: string;
  signal?: AbortSignal;
  config: DiscoveryProbeConfig;
  dependencies: Required<Pick<DiscoveryProbeDependencies, "fetchImpl" | "sleep" | "now" | "negativeCache">> & {
    limiters: Record<DiscoveryAtsType, SourceRequestLimiter>;
    circuits: Record<DiscoveryAtsType, AtsCircuit>;
    robotsPolicyFor(
      atsType: DiscoveryAtsType,
      targetUrl: string,
      signal?: AbortSignal,
    ): Promise<RobotsPolicy>;
  };
}

async function probeBoard(options: ProbeBoardOptions): Promise<ProbeAttempt> {
  const { atsType, token, signal, config, dependencies } = options;
  const endpoint = endpointDefinitions[atsType];
  const url = endpoint.buildUrl(token);
  const key = cacheKey(atsType, token);

  if (dependencies.negativeCache.has(key)) {
    return { atsType, token, url, outcome: "cached_miss" };
  }

  let robotsPolicy: RobotsPolicy;
  try {
    robotsPolicy = await dependencies.robotsPolicyFor(atsType, url, signal);
  } catch (cause) {
    dependencies.circuits[atsType].pause();
    return {
      atsType,
      token,
      url,
      outcome: "paused",
      error: `robots.txt policy could not be checked: ${errorMessage(cause)}`,
    };
  }
  if (!robotsPolicy.allows(url)) {
    dependencies.circuits[atsType].pause();
    return {
      atsType,
      token,
      url,
      outcome: "paused",
      error: "robots.txt disallows this ATS API path",
    };
  }
  dependencies.limiters[atsType].raiseMinRequestIntervalMs(
    robotsPolicy.crawlDelayMs,
  );

  return dependencies.limiters[atsType].run(async () => {
    if (dependencies.circuits[atsType].isOpen()) {
      return {
        atsType,
        token,
        url,
        outcome: "paused",
        error: "ATS host is paused after repeated retryable failures",
      };
    }

    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        await dependencies.limiters[atsType].waitForRequestSlot(
          signal,
        );
        response = await dependencies.fetchImpl(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": config.userAgent,
          },
          signal: requestSignal(config, signal),
        });
      } catch (cause) {
        if (signal?.aborted) throw cause;
        if (attempt === config.maxAttempts) {
          const paused = dependencies.circuits[atsType].recordFailure();
          return {
            atsType,
            token,
            url,
            outcome: paused ? "paused" : "failed",
            error: errorMessage(cause),
          };
        }
        await dependencies.sleep(
          backoffMs(config.retryBaseDelayMs, attempt),
          signal,
        );
        continue;
      }

      if (response.status === 404) {
        dependencies.circuits[atsType].recordHealthyResponse();
        dependencies.negativeCache.mark(key);
        return { atsType, token, url, outcome: "not_found", status: 404 };
      }

      if (!response.ok) {
        if (blockedStatus(response.status)) {
          dependencies.circuits[atsType].pause();
          return {
            atsType,
            token,
            url,
            outcome: "paused",
            status: response.status,
            error: `HTTP ${response.status}`,
          };
        }
        if (!retryableStatus(response.status)) {
          dependencies.circuits[atsType].recordHealthyResponse();
          return {
            atsType,
            token,
            url,
            outcome: "failed",
            status: response.status,
            error: `HTTP ${response.status}`,
          };
        }

        const retryDelayMs =
          retryAfterMs(response.headers.get("retry-after"), dependencies.now) ??
          backoffMs(config.retryBaseDelayMs, attempt);
        // Share upstream backoff with all queued probes for this ATS, not
        // only 429s. Repeated 5xx responses should be treated just as gently.
        dependencies.limiters[atsType].deferFor(retryDelayMs);
        if (attempt === config.maxAttempts) {
          const paused = dependencies.circuits[atsType].recordFailure();
          return {
            atsType,
            token,
            url,
            outcome: paused ? "paused" : "failed",
            status: response.status,
            error: `HTTP ${response.status}`,
          };
        }
        await dependencies.sleep(retryDelayMs, signal);
        continue;
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        const paused = dependencies.circuits[atsType].recordFailure();
        return {
          atsType,
          token,
          url,
          outcome: paused ? "paused" : "invalid_payload",
          status: response.status,
          error: errorMessage(cause),
        };
      }

      const parsed = endpoint.parse(payload);
      if (!parsed) {
        // A 2xx response is only healthy after it proves to be the documented
        // ATS board shape. WAF/error pages commonly arrive as HTTP 200; do
        // not let a sequence of those reset the host circuit breaker.
        const paused = dependencies.circuits[atsType].recordFailure();
        return {
          atsType,
          token,
          url,
          outcome: paused ? "paused" : "invalid_payload",
          status: response.status,
          error: "response shape did not match the ATS board contract",
        };
      }

      dependencies.circuits[atsType].recordHealthyResponse();
      dependencies.negativeCache.clear(key);
      return {
        atsType,
        token,
        url,
        outcome: "verified",
        status: response.status,
        jobCount: parsed.jobCount,
      };
    }

    return {
      atsType,
      token,
      url,
      outcome: "failed",
      error: "probe exhausted retries",
    };
  });
}

export interface DiscoveryVerifier {
  probe(candidate: CandidateCompany, signal?: AbortSignal): Promise<ProbeResult>;
  verify(
    candidate: CandidateCompany,
    signal?: AbortSignal,
  ): Promise<VerifiedCompany | null>;
}

export function createDiscoveryVerifier(
  configOverrides: Partial<DiscoveryProbeConfig> = {},
  dependencyOverrides: DiscoveryProbeDependencies = {},
): DiscoveryVerifier {
  const config = normalizedConfig(configOverrides);
  const dependencies = {
    fetchImpl: dependencyOverrides.fetchImpl ?? globalThis.fetch,
    sleep: dependencyOverrides.sleep ?? delay,
    now: dependencyOverrides.now ?? Date.now,
    negativeCache:
      dependencyOverrides.negativeCache ?? createNegativeProbeCache(),
    limiters: {
      greenhouse:
        dependencyOverrides.limiters?.greenhouse ??
        createSourceRequestLimiter({
          maxConcurrentRequests: config.maxConcurrentRequestsPerAts,
          minRequestIntervalMs: config.minRequestIntervalMs,
        }),
      lever:
        dependencyOverrides.limiters?.lever ??
        createSourceRequestLimiter({
          maxConcurrentRequests: config.maxConcurrentRequestsPerAts,
          minRequestIntervalMs: config.minRequestIntervalMs,
        }),
      ashby:
        dependencyOverrides.limiters?.ashby ??
        createSourceRequestLimiter({
          maxConcurrentRequests: config.maxConcurrentRequestsPerAts,
          minRequestIntervalMs: config.minRequestIntervalMs,
        }),
    },
    circuits: {
      greenhouse: createAtsCircuit(config.maxConsecutiveFailuresPerAts),
      lever: createAtsCircuit(config.maxConsecutiveFailuresPerAts),
      ashby: createAtsCircuit(config.maxConsecutiveFailuresPerAts),
    },
  };
  const robotsPolicies = new Map<DiscoveryAtsType, Promise<RobotsPolicy>>();

  async function robotsPolicyFor(
    atsType: DiscoveryAtsType,
    targetUrl: string,
    signal?: AbortSignal,
  ): Promise<RobotsPolicy> {
    if (dependencyOverrides.robotsPolicy) return dependencyOverrides.robotsPolicy;

    let policy = robotsPolicies.get(atsType);
    if (!policy) {
      const loadedPolicy = fetchRobotsPolicy(
        {
          targetUrl,
          userAgent: config.userAgent,
          timeoutMs: config.timeoutMs,
          maxAttempts: config.maxAttempts,
          retryBaseDelayMs: config.retryBaseDelayMs,
          signal,
        },
        {
          fetchImpl: dependencies.fetchImpl,
          sleep: dependencies.sleep,
          now: dependencies.now,
          requestLimiter: dependencies.limiters[atsType],
        },
      );
      policy = loadedPolicy.catch((cause) => {
        robotsPolicies.delete(atsType);
        throw cause;
      });
      robotsPolicies.set(atsType, policy);
    }
    return policy;
  }
  const boardDependencies = {
    ...dependencies,
    robotsPolicyFor,
  } as const;

  async function probe(
    candidate: CandidateCompany,
    signal?: AbortSignal,
  ): Promise<ProbeResult> {
    const attempts: ProbeAttempt[] = [];
    const tokens = candidateTokens(candidate);

    for (const token of tokens) {
      for (const atsType of atsOrder(candidate)) {
        const attempt = await probeBoard({
          atsType,
          token,
          signal,
          config,
          dependencies: boardDependencies,
        });
        attempts.push(attempt);

        if (attempt.outcome === "paused") {
          // A paused host is a run-level stop signal. Do not keep trying
          // other ATSes or slug variants for this candidate while upstream is
          // telling us to back away.
          return { candidate, attempts, company: null };
        }

        if (attempt.outcome === "verified") {
          return {
            candidate,
            attempts,
            company: {
              name: candidate.name.trim(),
              slug: companySlug(candidate.name),
              atsType,
              atsToken: token,
              careersUrl: endpointDefinitions[atsType].careersUrl(token),
              discoveredVia: candidate.discoveredVia,
              jobCount: attempt.jobCount ?? 0,
            },
          };
        }
      }
    }

    return { candidate, attempts, company: null };
  }

  return {
    probe,
    async verify(candidate, signal) {
      return (await probe(candidate, signal)).company;
    },
  };
}

const defaultVerifier = createDiscoveryVerifier();

/** Shared discovery contract for callers that do not need diagnostics. */
export const verify = defaultVerifier.verify;

/** Probe one candidate and retain diagnostics for batch reporting. */
export const probe = defaultVerifier.probe;

export { endpointDefinitions };
