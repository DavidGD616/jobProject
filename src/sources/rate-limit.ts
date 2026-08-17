export interface SourceRateLimitConfig {
  maxConcurrentRequests: number;
  minRequestIntervalMs: number;
}

export interface SourceRequestLimiter {
  /** Hold one source-operation slot for the complete fetch, including retries. */
  run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;

  /** Space the start of each HTTP request, including retry attempts. */
  waitForRequestSlot(signal?: AbortSignal): Promise<void>;

  /** Defer every future source request after a retryable upstream response. */
  deferFor(ms: number): void;

  /**
   * Increase the spacing floor after a source publishes a stricter
   * `Crawl-delay` in robots.txt. It can never weaken the configured limit.
   */
  raiseMinRequestIntervalMs(ms: number): void;
}

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("request aborted");
}

function delayOnce(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(signal ? abortReason(signal) : new Error("request aborted"));
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Abortable delay that handles server-provided Retry-After values larger than
 * one JavaScript timer can safely represent.
 */
export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) {
    throw new RangeError("delay must be a finite, non-negative number");
  }

  let remaining = ms;
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_TIMER_DELAY_MS);
    await delayOnce(chunk, signal);
    remaining -= chunk;
  }
}

type WaitingOperation = {
  resolve: () => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

class ConcurrencyGate {
  #active = 0;
  #waiting: WaitingOperation[] = [];

  constructor(private readonly maxConcurrentRequests: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw abortReason(signal);
    }

    if (this.#active < this.maxConcurrentRequests) {
      this.#active += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiting: WaitingOperation = {
        resolve: () => {
          signal?.removeEventListener("abort", waiting.onAbort!);
          this.#active += 1;
          resolve();
        },
        reject,
        signal,
      };

      waiting.onAbort = () => {
        const index = this.#waiting.indexOf(waiting);
        if (index >= 0) this.#waiting.splice(index, 1);
        reject(signal ? abortReason(signal) : new Error("request aborted"));
      };

      signal?.addEventListener("abort", waiting.onAbort, { once: true });
      this.#waiting.push(waiting);
    });
  }

  release(): void {
    this.#active -= 1;
    const next = this.#waiting.shift();
    if (next) next.resolve();
  }
}

/**
 * Build a process-local source limiter. It keeps public boards polite in two
 * ways: only a small number of company polls can be active, and their HTTP
 * request starts are separated by a fixed interval.
 */
export function createSourceRequestLimiter(
  config: SourceRateLimitConfig,
): SourceRequestLimiter {
  if (
    !Number.isInteger(config.maxConcurrentRequests) ||
    config.maxConcurrentRequests < 1
  ) {
    throw new RangeError("maxConcurrentRequests must be a positive integer");
  }
  if (
    !Number.isFinite(config.minRequestIntervalMs) ||
    config.minRequestIntervalMs < 0
  ) {
    throw new RangeError("minRequestIntervalMs must be a finite, non-negative number");
  }

  const gate = new ConcurrencyGate(config.maxConcurrentRequests);
  let minRequestIntervalMs = config.minRequestIntervalMs;
  let lastRequestStartedAt = 0;
  let nextRequestAt = 0;
  let deferredUntil = 0;

  function reserveRequestAt(): number {
    const requestAt = Math.max(Date.now(), nextRequestAt, deferredUntil);
    nextRequestAt = requestAt + minRequestIntervalMs;
    return requestAt;
  }

  return {
    async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      await gate.acquire(signal);
      try {
        return await operation();
      } finally {
        gate.release();
      }
    },

    async waitForRequestSlot(signal?: AbortSignal): Promise<void> {
      if (signal?.aborted) {
        throw abortReason(signal);
      }

      let requestAt = reserveRequestAt();
      while (true) {
        await delay(Math.max(0, requestAt - Date.now()), signal);
        if (Date.now() >= deferredUntil) {
          // Record the actual start rather than only the reservation. This
          // lets a robots.txt Crawl-delay apply to the very next request even
          // when the policy was learned from the preceding robots fetch.
          lastRequestStartedAt = Date.now();
          nextRequestAt = Math.max(
            nextRequestAt,
            lastRequestStartedAt + minRequestIntervalMs,
          );
          return;
        }

        // This caller reserved its first slot before a different request
        // received a 429. Reserve again after the shared cooldown so its
        // start stays spaced from the other waiting callers.
        requestAt = reserveRequestAt();
      }
    },

    deferFor(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError("rate-limit delay must be a finite, non-negative number");
      }

      deferredUntil = Math.max(deferredUntil, Date.now() + ms);
      nextRequestAt = Math.max(nextRequestAt, deferredUntil);
    },

    raiseMinRequestIntervalMs(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError("rate-limit interval must be a finite, non-negative number");
      }
      minRequestIntervalMs = Math.max(minRequestIntervalMs, ms);
      nextRequestAt = Math.max(
        nextRequestAt,
        lastRequestStartedAt + minRequestIntervalMs,
      );
    },
  };
}
