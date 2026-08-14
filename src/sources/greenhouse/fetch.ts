import type { SourceFetchConfig, SourceFetchResult } from "../_contract";
import {
  createSourceRequestLimiter,
  delay,
} from "../rate-limit";
import type { SourceRequestLimiter } from "../rate-limit";

import { greenhouseSourceConfig } from "./config";
import { greenhouseResponseSchema } from "./schema";
import type { GreenhouseJob } from "./schema";

const GREENHOUSE_JOBS_URL =
  "https://boards-api.greenhouse.io/v1/boards" as const;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_EXPONENTIAL_BACKOFF_MS = 8_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

const greenhouseRequestLimiter = createSourceRequestLimiter({
  maxConcurrentRequests: greenhouseSourceConfig.maxConcurrentRequests,
  minRequestIntervalMs: greenhouseSourceConfig.minRequestIntervalMs,
});

export interface GreenhouseFetchConfig extends SourceFetchConfig {
  /** Injectable controls for deterministic retry tests. */
  maxAttempts?: number;
  retryBaseDelayMs?: number;
}

export interface GreenhouseFetchDependencies {
  fetchImpl?: typeof globalThis.fetch;
  sleep?: typeof delay;
  requestLimiter?: SourceRequestLimiter;
}

export class GreenhouseFetchError extends Error {
  readonly status: number | undefined;
  readonly url: string;

  constructor(
    message: string,
    options: { url: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "GreenhouseFetchError";
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

function requestSignal(config: GreenhouseFetchConfig): AbortSignal {
  return config.signal
    ? AbortSignal.any([config.signal, AbortSignal.timeout(config.timeoutMs)])
    : AbortSignal.timeout(config.timeoutMs);
}

function boardUrl(token: string): string {
  const url = new URL(`${GREENHOUSE_JOBS_URL}/${encodeURIComponent(token)}/jobs`);
  url.searchParams.set("content", "true");
  return url.toString();
}

function requestHeaders(config: GreenhouseFetchConfig): HeadersInit {
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

function assertValidTimeout(config: GreenhouseFetchConfig, url: string): void {
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 0 ||
    config.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new GreenhouseFetchError(
      "Greenhouse source requires a non-negative timeoutMs within Node's timer range",
      { url },
    );
  }
}

async function fetchBoard(
  config: GreenhouseFetchConfig,
  dependencies: Required<GreenhouseFetchDependencies>,
): Promise<SourceFetchResult<GreenhouseJob>> {
  const token = config.company.atsToken?.trim();
  if (!token) {
    throw new GreenhouseFetchError(
      "Greenhouse source requires company.atsToken",
      { url: GREENHOUSE_JOBS_URL },
    );
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
        throw new GreenhouseFetchError("Greenhouse request failed", {
          url,
          cause,
        });
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
        throw new GreenhouseFetchError(
          `Greenhouse returned HTTP ${response.status}`,
          { url, status: response.status },
        );
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
      throw new GreenhouseFetchError("Greenhouse returned invalid JSON", {
        url,
        cause,
      });
    }

    const parsed = greenhouseResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GreenhouseFetchError(
        `Greenhouse returned an unexpected payload: ${parsed.error.message}`,
        { url, cause: parsed.error },
      );
    }

    return {
      kind: "fetched",
      postings: parsed.data.jobs,
      etag: response.headers.get("etag"),
    };
  }

  throw new GreenhouseFetchError("Greenhouse request exhausted retries", {
    url,
  });
}

/**
 * Create an isolated fetcher for tests. The exported production fetcher uses
 * the shared source policy so all Greenhouse boards share one polite limiter.
 */
export function createGreenhouseFetcher(
  overrides: GreenhouseFetchDependencies = {},
): (
  config: GreenhouseFetchConfig,
) => Promise<SourceFetchResult<GreenhouseJob>> {
  const dependencies: Required<GreenhouseFetchDependencies> = {
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
    sleep: overrides.sleep ?? delay,
    requestLimiter: overrides.requestLimiter ?? greenhouseRequestLimiter,
  };

  return (config) =>
    dependencies.requestLimiter.run(
      () => fetchBoard(config, dependencies),
      config.signal,
    );
}

/** Fetch all currently published jobs from one public Greenhouse board. */
export const fetch = createGreenhouseFetcher();
