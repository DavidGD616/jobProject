import { z } from "zod";

import { createSourceRequestLimiter, delay } from "../sources/rate-limit";
import type { SourceRequestLimiter } from "../sources/rate-limit";
import { fetchRobotsPolicy } from "../sources/robots";
import type { RobotsPolicy } from "../sources/robots";
import type { CandidateCompany } from "./_contract";
import { extractReverseAtsCandidates } from "./reverse-url";

const ADZUNA_API_URL = "https://api.adzuna.com/v1/api/jobs";
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_EXPONENTIAL_BACKOFF_MS = 8_000;

export interface AdzunaDiscoveryConfig {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  maxConcurrentRequests: number;
  minRequestIntervalMs: number;
  userAgent: string;
}

/** A small, polite policy for the optional aggregator API. */
export const adzunaDiscoveryConfig = {
  timeoutMs: 15_000,
  maxAttempts: 2,
  retryBaseDelayMs: 500,
  maxConcurrentRequests: 1,
  minRequestIntervalMs: 1_000,
  userAgent:
    "job-hunt-agent/0.1 (+https://github.com/DavidGD616/jobProject/issues)",
} as const satisfies AdzunaDiscoveryConfig;

const adzunaRequestLimiter = createSourceRequestLimiter({
  maxConcurrentRequests: adzunaDiscoveryConfig.maxConcurrentRequests,
  minRequestIntervalMs: adzunaDiscoveryConfig.minRequestIntervalMs,
});

const adzunaResponseSchema = z.object({
  results: z.array(z.object({
    company: z.object({ display_name: z.string().optional() }).optional(),
    redirect_url: z.string().url().optional(),
    title: z.string().optional(),
  })).default([]),
});

export interface AdzunaSearchOptions {
  appId: string;
  apiKey: string;
  country?: string;
  query: string;
  location?: string;
  page?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  signal?: AbortSignal;
  /** @deprecated Prefer the second-argument dependency injection in tests. */
  fetchImpl?: typeof fetch;
}

export interface AdzunaSearchDependencies {
  fetchImpl?: typeof globalThis.fetch;
  sleep?: typeof delay;
  now?: () => number;
  requestLimiter?: SourceRequestLimiter;
  /** Injectable policy for deterministic tests or a pre-approved source. */
  robotsPolicy?: RobotsPolicy;
}

export class AdzunaDiscoveryError extends Error {
  readonly status: number | undefined;
  readonly url: string;

  constructor(
    message: string,
    options: { url: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.status = options.status;
    this.url = options.url;
  }
}

export function parseAdzunaResponse(input: unknown): CandidateCompany[] {
  const parsed = adzunaResponseSchema.parse(input);
  const candidates = new Map<string, CandidateCompany>();
  for (const result of parsed.results) {
    const url = result.redirect_url ?? "";
    const company = result.company?.display_name?.trim();
    if (!company || !url) continue;
    const reverse = extractReverseAtsCandidates(url, "adzuna_reverse_url")[0];
    const candidate: CandidateCompany = reverse
      ? { ...reverse, name: company }
      : { name: company, discoveredVia: "adzuna" };
    const key = company.toLocaleLowerCase();
    const existing = candidates.get(key);
    // Prefer the direct ATS token when one result is a generic aggregator URL
    // and another is an official application URL for the same company.
    if (!existing || (!existing.atsToken && candidate.atsToken)) {
      candidates.set(key, candidate);
    }
  }
  return [...candidates.values()];
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
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
    MAX_EXPONENTIAL_BACKOFF_MS,
  );
}

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function diagnosticUrl(requestUrl: string): string {
  const url = new URL(requestUrl);
  // Query credentials and profile-derived search terms are valid transport
  // parameters but must never reach a thrown error, report, or terminal log.
  url.search = "";
  return url.toString();
}

function validTimeout(timeoutMs: number, url: string): number {
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new AdzunaDiscoveryError(
      "Adzuna discovery requires a timeout within Node's timer range",
      { url },
    );
  }
  return timeoutMs;
}

function validAttempts(maxAttempts: number, url: string): number {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new AdzunaDiscoveryError("Adzuna maxAttempts must be positive", { url });
  }
  return maxAttempts;
}

function validBaseDelay(retryBaseDelayMs: number, url: string): number {
  if (!Number.isFinite(retryBaseDelayMs) || retryBaseDelayMs < 0) {
    throw new AdzunaDiscoveryError(
      "Adzuna retryBaseDelayMs must be finite and non-negative",
      { url },
    );
  }
  return retryBaseDelayMs;
}

/**
 * Query Adzuna as an optional discovery scout. Its response is never stored
 * directly: callers must probe the returned candidates' official ATS boards.
 */
export async function searchAdzuna(
  options: AdzunaSearchOptions,
  dependencies: AdzunaSearchDependencies = {},
): Promise<CandidateCompany[]> {
  const country = options.country ?? "us";
  const page = options.page ?? 1;
  const url = new URL(`${ADZUNA_API_URL}/${country}/search/${page}.json`);
  url.searchParams.set("app_id", options.appId);
  url.searchParams.set("app_key", options.apiKey);
  url.searchParams.set("what", options.query);
  if (options.location) url.searchParams.set("where", options.location);
  const requestUrl = url.toString();
  const safeUrl = diagnosticUrl(requestUrl);
  const timeoutMs = validTimeout(
    options.timeoutMs ?? adzunaDiscoveryConfig.timeoutMs,
    safeUrl,
  );
  const maxAttempts = validAttempts(
    options.maxAttempts ?? adzunaDiscoveryConfig.maxAttempts,
    safeUrl,
  );
  const retryBaseDelayMs = validBaseDelay(
    options.retryBaseDelayMs ?? adzunaDiscoveryConfig.retryBaseDelayMs,
    safeUrl,
  );
  const fetchImpl = dependencies.fetchImpl ?? options.fetchImpl ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? delay;
  const now = dependencies.now ?? Date.now;
  const requestLimiter = dependencies.requestLimiter ?? adzunaRequestLimiter;

  let robotsPolicy = dependencies.robotsPolicy;
  if (!robotsPolicy) {
    try {
      robotsPolicy = await fetchRobotsPolicy(
        {
          targetUrl: requestUrl,
          userAgent: adzunaDiscoveryConfig.userAgent,
          timeoutMs,
          maxAttempts,
          retryBaseDelayMs,
          signal: options.signal,
        },
        { fetchImpl, sleep, now, requestLimiter },
      );
    } catch (cause) {
      throw new AdzunaDiscoveryError(
        "Adzuna robots.txt policy could not be checked",
        { url: safeUrl, cause },
      );
    }
  }
  if (!robotsPolicy.allows(requestUrl)) {
    throw new AdzunaDiscoveryError(
      "robots.txt disallows this Adzuna API path",
      { url: safeUrl },
    );
  }
  requestLimiter.raiseMinRequestIntervalMs(robotsPolicy.crawlDelayMs);

  try {
    return await requestLimiter.run(async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let response: Response;
        try {
          await requestLimiter.waitForRequestSlot(options.signal);
          response = await fetchImpl(requestUrl, {
            signal: requestSignal(timeoutMs, options.signal),
            headers: {
              Accept: "application/json",
              "User-Agent": adzunaDiscoveryConfig.userAgent,
            },
          });
        } catch (cause) {
          if (options.signal?.aborted || attempt === maxAttempts) {
            throw new AdzunaDiscoveryError("Adzuna request failed", {
              url: safeUrl,
              cause,
            });
          }
          await sleep(backoffMs(retryBaseDelayMs, attempt), options.signal);
          continue;
        }

        if (!response.ok) {
          const retryDelayMs =
            retryAfterMs(response.headers.get("retry-after"), now) ??
            backoffMs(retryBaseDelayMs, attempt);
          if (retryableStatus(response.status) && attempt < maxAttempts) {
            requestLimiter.deferFor(retryDelayMs);
            await sleep(retryDelayMs, options.signal);
            continue;
          }
          throw new AdzunaDiscoveryError(
            `Adzuna returned HTTP ${response.status}`,
            { url: safeUrl, status: response.status },
          );
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new AdzunaDiscoveryError("Adzuna returned invalid JSON", {
            url: safeUrl,
            cause,
          });
        }
        try {
          return parseAdzunaResponse(payload);
        } catch (cause) {
          throw new AdzunaDiscoveryError(
            "Adzuna response did not match the expected contract",
            { url: safeUrl, cause },
          );
        }
      }

      throw new AdzunaDiscoveryError("Adzuna request exhausted retries", {
        url: safeUrl,
      });
    }, options.signal);
  } catch (cause) {
    if (cause instanceof AdzunaDiscoveryError) throw cause;
    throw new AdzunaDiscoveryError("Adzuna request failed", {
      url: safeUrl,
      cause,
    });
  }
}
