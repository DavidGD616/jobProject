import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  allowAllRobotsPolicy,
  createSourceRequestLimiter,
  sourceRegistry,
} from "@/sources";
import type { SourceRequestLimiter } from "@/sources";
import {
  adapter,
  createGreenhouseFetcher,
  GreenhouseFetchError,
  greenhouseResponseSchema,
  greenhouseSourceConfig,
  normalize,
  sourceId,
} from "@/sources/greenhouse";
import type {
  GreenhouseFetchConfig,
  GreenhouseFetchDependencies,
} from "@/sources/greenhouse";

const fixture = greenhouseResponseSchema.parse(
  JSON.parse(
    readFileSync("tests/fixtures/greenhouse/jobs.json", "utf8"),
  ),
);

function config(
  overrides: Partial<GreenhouseFetchConfig> = {},
): GreenhouseFetchConfig {
  return {
    company: {
      id: 1,
      name: "Stripe",
      atsType: "greenhouse",
      atsToken: "stripe",
      careersUrl: "https://stripe.com/jobs",
    },
    userAgent: "job-hunt-agent-test/1.0 (+https://example.test/contact)",
    timeoutMs: 5_000,
    ...overrides,
  };
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function testFetcher(
  overrides: GreenhouseFetchDependencies = {},
) {
  return createGreenhouseFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: 2,
      minRequestIntervalMs: 0,
    }),
    robotsPolicy: allowAllRobotsPolicy,
    sleep: async () => {},
    ...overrides,
  });
}

test("fixture parses as a Greenhouse Job Board response", () => {
  assert.equal(fixture.jobs.length, 3);
  assert.equal(fixture.meta?.total, 564);
  assert.equal(fixture.jobs[0]?.id, 8_077_887);
});

test("normalization maps Greenhouse fields and derives remote type", () => {
  const posting = normalize(fixture.jobs[0]!);
  const multiOfficePosting = normalize(fixture.jobs[2]!);
  const remotePosting = normalize({
    ...fixture.jobs[0]!,
    location: {
      // Recorded from a live Greenhouse/Stripe board location shape.
      name: "US-Remote, US-San Francisco, US-Chicago, US-New York",
    },
  });

  assert.equal(posting.url, fixture.jobs[0]!.absolute_url);
  assert.equal(posting.title, "Account Executive, Bridge");
  assert.equal(posting.titleNorm, "account executive, bridge");
  assert.equal(posting.location, "SF, NYC, SEA, CHI");
  assert.equal(posting.remoteType, "unknown");
  assert.equal(posting.postedAt?.toISOString(), "2026-07-22T17:15:53.000Z");
  assert.match(posting.description, /Who we are/);
  assert.match(posting.description, /Stripe is a financial infrastructure platform/);
  assert.doesNotMatch(posting.description, /<[^>]+>/);
  assert.doesNotMatch(posting.description, /&lt;|&gt;|&quot;/);

  assert.equal(multiOfficePosting.title, "AI Product Manager, Professional Services");
  assert.equal(multiOfficePosting.location, "New York/ San Francisco");
  assert.equal(remotePosting.remoteType, "remote");
  assert.equal(
    normalize({ ...fixture.jobs[0]!, location: { name: "Hybrid — London" } })
      .remoteType,
    "hybrid",
  );
  assert.equal(
    normalize({ ...fixture.jobs[0]!, location: { name: "On-site — Berlin" } })
      .remoteType,
    "onsite",
  );
});

test("normalization is deterministic and does not mutate raw Greenhouse data", () => {
  const raw = fixture.jobs[0]!;
  const before = structuredClone(raw);

  const first = normalize(raw);
  const second = normalize(raw);

  assert.deepEqual(raw, before);
  assert.deepEqual(first, second);
});

test("sourceId uses the stable upstream Greenhouse job ID", () => {
  const raw = fixture.jobs[0]!;

  assert.equal(sourceId(raw), "8077887");
  assert.equal(sourceId({ ...raw, content: "updated description" }), "8077887");
});

test("Greenhouse is registered as a polite Tier 1 source", () => {
  assert.equal(sourceRegistry.greenhouse.adapter, adapter);
  assert.equal(greenhouseSourceConfig.cadenceMs, 6 * 60 * 60 * 1_000);
  assert.equal(greenhouseSourceConfig.maxConcurrentRequests, 2);
  assert.equal(greenhouseSourceConfig.minRequestIntervalMs, 500);
  assert.match(greenhouseSourceConfig.userAgent, /github\.com\/DavidGD616\/jobProject\/issues/);
});

test("fetch requests the public board endpoint and captures its ETag", async () => {
  let requestedUrl: string | undefined;
  let requestedHeaders: Headers | undefined;
  const fetcher = testFetcher({
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse(fixture, { headers: { etag: 'W/"board-v1"' } });
    },
  });

  const result = await fetcher(config());

  assert.equal(result.kind, "fetched");
  if (result.kind !== "fetched") assert.fail("expected a fetched result");
  assert.equal(result.postings.length, 3);
  assert.equal(result.etag, 'W/"board-v1"');
  assert.equal(
    requestedUrl,
    "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true",
  );
  assert.equal(requestedHeaders?.get("accept"), "application/json");
  assert.equal(
    requestedHeaders?.get("user-agent"),
    "job-hunt-agent-test/1.0 (+https://example.test/contact)",
  );
  assert.equal(requestedHeaders?.get("if-none-match"), null);
});

test("fetch checks robots.txt before requesting a Greenhouse board", async () => {
  const requestedUrls: string[] = [];
  const fetcher = createGreenhouseFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: 1,
      minRequestIntervalMs: 0,
    }),
    fetchImpl: async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nDisallow: /v1/boards/stripe/jobs\n", {
          headers: { "content-type": "text/plain" },
        });
      }
      throw new Error("board API must not be reached when robots disallows it");
    },
  });

  await assert.rejects(
    () => fetcher(config()),
    (error: unknown) =>
      error instanceof GreenhouseFetchError &&
      /robots\.txt disallows/.test(error.message),
  );
  assert.deepEqual(requestedUrls, ["https://boards-api.greenhouse.io/robots.txt"]);
});

test("fetch treats a conditional 304 as unchanged rather than an empty board", async () => {
  let requestedHeaders: Headers | undefined;
  const fetcher = testFetcher({
    fetchImpl: async (_input, init) => {
      requestedHeaders = new Headers(init?.headers);
      return new Response(null, { status: 304 });
    },
  });

  const result = await fetcher(config({ etag: 'W/"board-v1"' }));

  assert.deepEqual(result, {
    kind: "not_modified",
    etag: 'W/"board-v1"',
  });
  assert.equal(requestedHeaders?.get("if-none-match"), 'W/"board-v1"');
});

test("fetch keeps a successful empty board distinct from a conditional 304", async () => {
  const fetcher = testFetcher({
    fetchImpl: async () => jsonResponse({ jobs: [], meta: { total: 0 } }),
  });

  const result = await fetcher(config());

  assert.deepEqual(result, { kind: "fetched", postings: [], etag: null });
});

test("fetch retries rate limits, preserves its validator, and honors long Retry-After", async () => {
  let attempts = 0;
  let secondRequestHeaders: Headers | undefined;
  const delays: number[] = [];
  const sourceCooldowns: number[] = [];
  const requestLimiter: SourceRequestLimiter = {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    },
    async waitForRequestSlot(): Promise<void> {},
    deferFor(ms: number): void {
      sourceCooldowns.push(ms);
    },
    raiseMinRequestIntervalMs(): void {},
  };
  const fetcher = testFetcher({
    fetchImpl: async (_input, init) => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "60" },
        });
      }
      secondRequestHeaders = new Headers(init?.headers);
      return jsonResponse(fixture);
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
    requestLimiter,
  });

  const result = await fetcher(
    config({ etag: 'W/"board-v1"', maxAttempts: 2, retryBaseDelayMs: 0 }),
  );

  assert.equal(attempts, 2);
  assert.deepEqual(delays, [60_000]);
  assert.deepEqual(sourceCooldowns, [60_000]);
  assert.equal(secondRequestHeaders?.get("if-none-match"), 'W/"board-v1"');
  assert.equal(result.kind, "fetched");
});

test("fetch preserves the cooldown from a final 429 for later boards", async () => {
  const sourceCooldowns: number[] = [];
  const requestLimiter: SourceRequestLimiter = {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      return operation();
    },
    async waitForRequestSlot(): Promise<void> {},
    deferFor(ms: number): void {
      sourceCooldowns.push(ms);
    },
    raiseMinRequestIntervalMs(): void {},
  };
  const fetcher = testFetcher({
    fetchImpl: async () =>
      new Response(null, { status: 429, headers: { "retry-after": "60" } }),
    requestLimiter,
  });

  await assert.rejects(
    fetcher(config({ maxAttempts: 1 })),
    (error: unknown) => {
      assert.ok(error instanceof GreenhouseFetchError);
      assert.equal(error.status, 429);
      assert.equal(error.retryDelayMs, 60_000);
      return true;
    },
  );
  assert.deepEqual(sourceCooldowns, [60_000]);
});

test("fetch retries transient network and server failures, but not client failures", async () => {
  let networkAttempts = 0;
  const networkDelays: number[] = [];
  const networkFetcher = testFetcher({
    fetchImpl: async () => {
      networkAttempts += 1;
      if (networkAttempts === 1) throw new Error("socket reset");
      return jsonResponse(fixture);
    },
    sleep: async (ms) => {
      networkDelays.push(ms);
    },
  });

  const networkResult = await networkFetcher(
    config({ maxAttempts: 2, retryBaseDelayMs: 25 }),
  );
  assert.equal(networkAttempts, 2);
  assert.deepEqual(networkDelays, [25]);
  assert.equal(networkResult.kind, "fetched");

  let serverAttempts = 0;
  const serverDelays: number[] = [];
  const serverFetcher = testFetcher({
    fetchImpl: async () => {
      serverAttempts += 1;
      if (serverAttempts === 1) return new Response(null, { status: 503 });
      return jsonResponse(fixture);
    },
    sleep: async (ms) => {
      serverDelays.push(ms);
    },
  });

  const serverResult = await serverFetcher(
    config({ maxAttempts: 2, retryBaseDelayMs: 25 }),
  );
  assert.equal(serverAttempts, 2);
  assert.deepEqual(serverDelays, [25]);
  assert.equal(serverResult.kind, "fetched");

  let clientAttempts = 0;
  const clientFetcher = testFetcher({
    fetchImpl: async () => {
      clientAttempts += 1;
      return new Response(null, { status: 404 });
    },
  });

  await assert.rejects(
    clientFetcher(config({ maxAttempts: 3 })),
    (error: unknown) => {
      assert.ok(error instanceof GreenhouseFetchError);
      assert.equal(error.status, 404);
      return true;
    },
  );
  assert.equal(clientAttempts, 1);
});

test("fetch turns a request timeout into a source error", async () => {
  const fetcher = testFetcher({
    fetchImpl: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) throw new Error("expected an abort signal");
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  });

  await assert.rejects(
    fetcher(config({ maxAttempts: 1, timeoutMs: 0 })),
    (error: unknown) => {
      assert.ok(error instanceof GreenhouseFetchError);
      assert.match(error.message, /request failed/);
      return true;
    },
  );
});

test("fetch validates timeout values before starting a request", async () => {
  let attempts = 0;
  const fetcher = testFetcher({
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse(fixture);
    },
  });

  for (const timeoutMs of [0.5, 2_147_483_648]) {
    await assert.rejects(
      fetcher(config({ timeoutMs })),
      (error: unknown) => {
        assert.ok(error instanceof GreenhouseFetchError);
        assert.match(error.message, /timeoutMs/);
        return true;
      },
    );
  }
  assert.equal(attempts, 0);
});

test("fetch caps concurrent Greenhouse board requests at the registered policy", async () => {
  let active = 0;
  let maximumActive = 0;
  const fetcher = createGreenhouseFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: greenhouseSourceConfig.maxConcurrentRequests,
      minRequestIntervalMs: 0,
    }),
    robotsPolicy: allowAllRobotsPolicy,
    sleep: async () => {},
    fetchImpl: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return jsonResponse(fixture);
    },
  });

  const requests = ["stripe-a", "stripe-b", "stripe-c", "stripe-d"].map(
    (atsToken) =>
      fetcher(
        config({
          company: {
            ...config().company,
            atsToken,
          },
        }),
      ),
  );

  await Promise.all(requests);
  assert.equal(maximumActive, greenhouseSourceConfig.maxConcurrentRequests);
});

test("source rate limiter defers new requests after a source-wide 429 cooldown", async () => {
  const limiter = createSourceRequestLimiter({
    maxConcurrentRequests: 2,
    minRequestIntervalMs: 0,
  });
  limiter.deferFor(20);

  const startedAt = Date.now();
  await limiter.waitForRequestSlot();

  assert.ok(Date.now() - startedAt >= 15);
});

test("fetch rejects a malformed successful payload without retrying", async () => {
  let attempts = 0;
  const fetcher = testFetcher({
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ jobs: [{ id: "not-a-number" }] });
    },
  });

  await assert.rejects(
    fetcher(config({ maxAttempts: 3, retryBaseDelayMs: 0 })),
    (error: unknown) => {
      assert.ok(error instanceof GreenhouseFetchError);
      assert.match(error.message, /unexpected payload/);
      return true;
    },
  );
  assert.equal(attempts, 1);
});
