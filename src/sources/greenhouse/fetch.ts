import { greenhouseResponseSchema } from "./schema";
import type { GreenhouseJob } from "./schema";
import type { SourceFetchConfig } from "@/sources";

const GREENHOUSE_JOBS_URL =
  "https://boards-api.greenhouse.io/v1/boards" as const;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const MAX_RETRY_DELAY_MS = 8_000;

export interface GreenhouseFetchConfig extends SourceFetchConfig {
  /** Injectable for tests; production uses the conservative default. */
  maxAttempts?: number;
  retryBaseDelayMs?: number;
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

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.min(Math.max(0, seconds * 1_000), MAX_RETRY_DELAY_MS);
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return null;

  return Math.min(Math.max(0, dateMs - Date.now()), MAX_RETRY_DELAY_MS);
}

function backoffMs(baseDelayMs: number, attempt: number): number {
  return Math.min(
    Math.max(0, baseDelayMs) * 2 ** (attempt - 1),
    MAX_RETRY_DELAY_MS,
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("request aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal?.reason ?? new Error("request aborted"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function requestSignal(config: GreenhouseFetchConfig): AbortSignal {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  return config.signal ? AbortSignal.any([config.signal, timeout]) : timeout;
}

function boardUrl(token: string): string {
  const url = new URL(`${GREENHOUSE_JOBS_URL}/${encodeURIComponent(token)}/jobs`);
  url.searchParams.set("content", "true");
  return url.toString();
}

/** Fetch all currently published jobs from one public Greenhouse board. */
export async function fetch(
  config: GreenhouseFetchConfig,
): Promise<GreenhouseJob[]> {
  const token = config.company.atsToken?.trim();
  if (!token) {
    throw new GreenhouseFetchError(
      "Greenhouse source requires company.atsToken",
      { url: GREENHOUSE_JOBS_URL },
    );
  }

  const url = boardUrl(token);
  const maxAttempts = Math.max(
    1,
    Math.floor(config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
  );
  const baseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;

    try {
      response = await globalThis.fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": config.userAgent,
        },
        signal: requestSignal(config),
      });
    } catch (cause) {
      if (config.signal?.aborted || attempt === maxAttempts) {
        throw new GreenhouseFetchError("Greenhouse request failed", {
          url,
          cause,
        });
      }

      await sleep(backoffMs(baseDelayMs, attempt), config.signal);
      continue;
    }

    if (!response.ok) {
      if (!retryableStatus(response.status) || attempt === maxAttempts) {
        throw new GreenhouseFetchError(
          `Greenhouse returned HTTP ${response.status}`,
          { url, status: response.status },
        );
      }

      await sleep(
        retryAfterMs(response.headers.get("retry-after")) ??
          backoffMs(baseDelayMs, attempt),
        config.signal,
      );
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

    return parsed.data.jobs;
  }

  throw new GreenhouseFetchError("Greenhouse request exhausted retries", {
    url,
  });
}
