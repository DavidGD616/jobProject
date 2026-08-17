import type { SourceFetchConfig, SourceFetchResult } from "../_contract";
import {
  createSourceRequestLimiter,
  delay,
} from "../rate-limit";
import type { SourceRequestLimiter } from "../rate-limit";
import { fetchRobotsPolicy } from "../robots";
import type { RobotsPolicy } from "../robots";

import { leverSourceConfig } from "./config";
import { leverResponseSchema } from "./schema";
import type { LeverJob } from "./schema";

const LEVER_POSTINGS_URL = "https://api.lever.co/v0/postings" as const;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_EXPONENTIAL_BACKOFF_MS = 8_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

const leverRequestLimiter = createSourceRequestLimiter({
  maxConcurrentRequests: leverSourceConfig.maxConcurrentRequests,
  minRequestIntervalMs: leverSourceConfig.minRequestIntervalMs,
});

export interface LeverFetchConfig extends SourceFetchConfig {
  /** Injectable controls for deterministic retry tests. */
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface LeverFetchDependencies {
  fetchImpl?: typeof globalThis.fetch;
  sleep?: typeof delay;
  requestLimiter?: SourceRequestLimiter;
  /** Injectable policy for deterministic tests or a pre-approved source. */
  robotsPolicy?: RobotsPolicy;
}

export class LeverFetchError extends Error {
  readonly status: number | undefined;
  readonly url: string;

  constructor(
    message: string,
    options: { url: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "LeverFetchError";
    this.status = options.status;
    this.url = options.url;
  }
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Honor the server's full delay. `delay` chunks values larger than one Node
 * timer, so a long Retry-After never becomes an earlier retry.
 */
function retryAfterMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return null;

  return Math.max(0, dateMs - Date.now());
}

function backoffMs(baseDelayMs: number, attempt: number): number {
  return Math.min(
    Math.max(0, baseDelayMs) * 2 ** (attempt - 1),
    MAX_EXPONENTIAL_BACKOFF_MS,
  );
}

function requestSignal(config: LeverFetchConfig): AbortSignal {
  return config.signal
    ? AbortSignal.any([config.signal, AbortSignal.timeout(config.timeoutMs)])
    : AbortSignal.timeout(config.timeoutMs);
}

function boardUrl(token: string): string {
  const url = new URL(`${LEVER_POSTINGS_URL}/${encodeURIComponent(token)}`);
  url.searchParams.set("mode", "json");
  return url.toString();
}

function requestHeaders(config: LeverFetchConfig): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent": config.userAgent,
  };
  if (config.etag) headers["If-None-Match"] = config.etag;
  return headers;
}

function normalizedMaxAttempts(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.floor(value));
}

function normalizedBaseDelay(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_RETRY_BASE_DELAY_MS;
  }
  return Math.max(0, value);
}

function assertValidTimeout(config: LeverFetchConfig, url: string): void {
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 0 ||
    config.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new LeverFetchError(
      "Lever source requires a non-negative timeoutMs within Node's timer range",
      { url },
    );
  }
}

async function fetchBoard(
  config: LeverFetchConfig,
  dependencies: Pick<
    Required<LeverFetchDependencies>,
    "fetchImpl" | "sleep" | "requestLimiter"
  >,
): Promise<SourceFetchResult<LeverJob>> {
  const token = config.company.atsToken?.trim();
  if (!token) {
    throw new LeverFetchError("Lever source requires company.atsToken", {
      url: LEVER_POSTINGS_URL,
    });
  }

  const url = boardUrl(token);
  assertValidTimeout(config, url);
  const maxAttempts = normalizedMaxAttempts(config.maxAttempts);
  const baseDelayMs = normalizedBaseDelay(config.retryBaseDelayMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;

    try {
      await dependencies.requestLimiter.waitForRequestSlot(config.signal);
      response = await dependencies.fetchImpl(url, {
        headers: requestHeaders(config),
        signal: requestSignal(config),
      });
    } catch (cause) {
      if (config.signal?.aborted || attempt === maxAttempts) {
        throw new LeverFetchError("Lever request failed", { url, cause });
      }

      await dependencies.sleep(backoffMs(baseDelayMs, attempt), config.signal);
      continue;
    }

    if (response.status === 304) {
      return {
        kind: "not_modified",
        etag: response.headers.get("etag") ?? config.etag ?? null,
      };
    }

    if (!response.ok) {
      if (!retryableStatus(response.status) || attempt === maxAttempts) {
        throw new LeverFetchError(`Lever returned HTTP ${response.status}`, {
          url,
          status: response.status,
        });
      }

      const retryDelayMs =
        retryAfterMs(response.headers.get("retry-after")) ??
        backoffMs(baseDelayMs, attempt);
      if (response.status === 429) {
        dependencies.requestLimiter.deferFor(retryDelayMs);
      }
      await dependencies.sleep(retryDelayMs, config.signal);
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new LeverFetchError("Lever returned invalid JSON", { url, cause });
    }

    const parsed = leverResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new LeverFetchError(
        `Lever returned an unexpected payload: ${parsed.error.message}`,
        { url, cause: parsed.error },
      );
    }

    return {
      kind: "fetched",
      postings: parsed.data,
      etag: response.headers.get("etag"),
    };
  }

  throw new LeverFetchError("Lever request exhausted retries", { url });
}

/**
 * Create an isolated fetcher for tests. The exported production fetcher uses
 * the shared source policy so all Lever boards share one polite limiter.
 */
export function createLeverFetcher(
  overrides: LeverFetchDependencies = {},
): (
  config: LeverFetchConfig,
) => Promise<SourceFetchResult<LeverJob>> {
  const dependencies = {
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
    sleep: overrides.sleep ?? delay,
    requestLimiter: overrides.requestLimiter ?? leverRequestLimiter,
  };
  const injectedRobotsPolicy = overrides.robotsPolicy;
  const robotsPolicies = new Map<string, Promise<RobotsPolicy>>();

  async function ensureRobotsPolicy(
    config: LeverFetchConfig,
    url: string,
  ): Promise<void> {
    let robotsPolicy = injectedRobotsPolicy;
    if (!robotsPolicy) {
      let policy = robotsPolicies.get(config.userAgent);
      if (!policy) {
        const loadedPolicy = fetchRobotsPolicy(
          {
            targetUrl: url,
            userAgent: config.userAgent,
            timeoutMs: config.timeoutMs,
            maxAttempts: normalizedMaxAttempts(config.maxAttempts),
            retryBaseDelayMs: normalizedBaseDelay(config.retryBaseDelayMs),
            signal: config.signal,
          },
          {
            fetchImpl: dependencies.fetchImpl,
            sleep: dependencies.sleep,
            requestLimiter: dependencies.requestLimiter,
          },
        );
        policy = loadedPolicy.catch((cause) => {
          robotsPolicies.delete(config.userAgent);
          throw cause;
        });
        robotsPolicies.set(config.userAgent, policy);
      }
      robotsPolicy = await policy;
    }
    if (!robotsPolicy.allows(url)) {
      throw new LeverFetchError("robots.txt disallows this Lever API path", {
        url,
      });
    }
    dependencies.requestLimiter.raiseMinRequestIntervalMs(
      robotsPolicy.crawlDelayMs,
    );
  }

  return async (config) => {
    const token = config.company.atsToken?.trim();
    if (token) {
      const url = boardUrl(token);
      try {
        await ensureRobotsPolicy(config, url);
      } catch (cause) {
        if (cause instanceof LeverFetchError) throw cause;
        throw new LeverFetchError("Lever robots.txt policy could not be checked", {
          url,
          cause,
        });
      }
    }
    return dependencies.requestLimiter.run(
      () => fetchBoard(config, dependencies),
      config.signal,
    );
  };
}

/** Fetch all currently published jobs from one public Lever board. */
export const fetch = createLeverFetcher();
