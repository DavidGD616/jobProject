import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { allowAllRobotsPolicy, createSourceRequestLimiter } from "@/sources";
import type { SourceRequestLimiter } from "@/sources";
import {
  adapter,
  ashbyResponseSchema,
  ashbySourceConfig,
  AshbyFetchError,
  createAshbyFetcher,
  normalize,
  sourceId,
} from "@/sources/ashby";
import type {
  AshbyFetchConfig,
  AshbyFetchDependencies,
} from "@/sources/ashby";

const fixture = ashbyResponseSchema.parse(
  JSON.parse(readFileSync("tests/fixtures/ashby/jobs.json", "utf8")),
);

function config(overrides: Partial<AshbyFetchConfig> = {}): AshbyFetchConfig {
  return {
    company: {
      id: 1,
      name: "PermitFlow",
      atsType: "ashby",
      atsToken: "permitflow",
      careersUrl: "https://permitflow.com/careers",
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

function testFetcher(overrides: AshbyFetchDependencies = {}) {
  return createAshbyFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: 2,
      minRequestIntervalMs: 0,
    }),
    robotsPolicy: allowAllRobotsPolicy,
    sleep: async () => {},
    ...overrides,
  });
}

test("fixture parses as an Ashby Job Board response", () => {
  assert.equal(fixture.jobs.length, 2);
  assert.equal(fixture.jobs[0]?.id, "9c3cac9e-2a67-4d7e-8098-42092a628390");
});

test("normalization maps Ashby metadata, structured compensation, and remote type", () => {
  const hybridPosting = normalize(fixture.jobs[0]!);
  const remotePosting = normalize(fixture.jobs[1]!);

  assert.equal(hybridPosting.url, fixture.jobs[0]!.jobUrl);
  assert.equal(hybridPosting.title, "Staff Product Designer");
  assert.equal(hybridPosting.titleNorm, "product designer");
  assert.equal(hybridPosting.location, "New York City, NY");
  assert.equal(hybridPosting.remoteType, "hybrid");
  assert.equal(hybridPosting.salaryMin, 200_000);
  assert.equal(hybridPosting.salaryMax, 275_000);
  assert.equal(hybridPosting.salaryPeriod, "year");
  assert.equal(hybridPosting.currency, "USD");
  assert.equal(hybridPosting.postedAt?.toISOString(), "2026-07-28T05:03:53.353Z");
  assert.match(hybridPosting.description, /PermitFlow is redefining how America builds/);
  assert.match(hybridPosting.description, /What You’ll Do/);
  assert.doesNotMatch(hybridPosting.description, /<[^>]+>/);

  assert.equal(
    remotePosting.location,
    "Remote / Indonesia / Guyana / Canada / Philippines",
  );
  assert.equal(remotePosting.remoteType, "remote");
  assert.equal(remotePosting.salaryMin, 5);
  assert.equal(remotePosting.salaryMax, 7);
  assert.equal(remotePosting.salaryPeriod, "hour");
});

test("normalization falls back to descriptionPlain and prioritizes workplaceType", () => {
  const raw = {
    ...fixture.jobs[0]!,
    descriptionHtml: null,
    descriptionPlain: "Plain Ashby description",
    workplaceType: "On-site",
    isRemote: true,
  };

  const posting = normalize(raw);

  assert.equal(posting.description, "Plain Ashby description");
  assert.equal(posting.remoteType, "onsite");
});

test("normalization falls back to published compensation tiers and rejects mixed ranges", () => {
  const tierPosting = normalize({
    ...fixture.jobs[0]!,
    compensation: {
      summaryComponents: [],
      compensationTiers: [
        {
          components: [
            {
              compensationType: "Salary",
              interval: "1 MONTH",
              currencyCode: "USD",
              minValue: 10_000,
              maxValue: 12_000,
            },
          ],
        },
      ],
    },
  });
  const ambiguousPosting = normalize({
    ...fixture.jobs[0]!,
    compensation: {
      summaryComponents: [
        {
          compensationType: "Salary",
          interval: "1 YEAR",
          currencyCode: "USD",
          minValue: 100_000,
          maxValue: 120_000,
        },
        {
          compensationType: "Salary",
          interval: "1 YEAR",
          currencyCode: "EUR",
          minValue: 100_000,
          maxValue: 120_000,
        },
      ],
    },
  });

  assert.equal(tierPosting.salaryMin, 10_000);
  assert.equal(tierPosting.salaryMax, 12_000);
  assert.equal(tierPosting.salaryPeriod, "month");
  assert.equal(tierPosting.currency, "USD");
  assert.equal(ambiguousPosting.salaryMin, null);
  assert.equal(ambiguousPosting.salaryMax, null);
  assert.equal(ambiguousPosting.salaryPeriod, null);
  assert.equal(ambiguousPosting.currency, null);
});

test("normalization is deterministic and does not mutate raw Ashby data", () => {
  const raw = fixture.jobs[0]!;
  const before = structuredClone(raw);

  const first = normalize(raw);
  const second = normalize(raw);

  assert.deepEqual(raw, before);
  assert.deepEqual(first, second);
});

test("sourceId uses the stable upstream Ashby job ID", () => {
  const raw = fixture.jobs[0]!;

  assert.equal(sourceId(raw), "9c3cac9e-2a67-4d7e-8098-42092a628390");
  assert.equal(
    sourceId({ ...raw, descriptionHtml: "updated description" }),
    "9c3cac9e-2a67-4d7e-8098-42092a628390",
  );
});

test("Ashby has a polite Tier 1 source policy and shared adapter", () => {
  assert.equal(adapter.normalize, normalize);
  assert.equal(ashbySourceConfig.cadenceMs, 6 * 60 * 60 * 1_000);
  assert.equal(ashbySourceConfig.maxConcurrentRequests, 2);
  assert.equal(ashbySourceConfig.minRequestIntervalMs, 500);
  assert.match(
    ashbySourceConfig.userAgent,
    /github\.com\/DavidGD616\/jobProject\/issues/,
  );
});

test("fetch requests the public Ashby board with compensation and captures its ETag", async () => {
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
  assert.equal(result.postings.length, 2);
  assert.equal(result.etag, 'W/"board-v1"');
  assert.equal(
    requestedUrl,
    "https://api.ashbyhq.com/posting-api/job-board/permitflow?includeCompensation=true",
  );
  assert.equal(requestedHeaders?.get("accept"), "application/json");
  assert.equal(
    requestedHeaders?.get("user-agent"),
    "job-hunt-agent-test/1.0 (+https://example.test/contact)",
  );
  assert.equal(requestedHeaders?.get("if-none-match"), null);
});

test("fetch checks robots.txt before requesting an Ashby board", async () => {
  const requestedUrls: string[] = [];
  const fetcher = createAshbyFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: 1,
      minRequestIntervalMs: 0,
    }),
    fetchImpl: async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response(
          "User-agent: *\nDisallow: /posting-api/job-board/permitflow\n",
          { headers: { "content-type": "text/plain" } },
        );
      }
      throw new Error("board API must not be reached when robots disallows it");
    },
  });

  await assert.rejects(
    () => fetcher(config()),
    (error: unknown) =>
      error instanceof AshbyFetchError && /robots\.txt disallows/.test(error.message),
  );
  assert.deepEqual(requestedUrls, ["https://api.ashbyhq.com/robots.txt"]);
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
    fetchImpl: async () => jsonResponse({ jobs: [] }),
  });

  const result = await fetcher(config());

  assert.deepEqual(result, { kind: "fetched", postings: [], etag: null });
});

test("fetch retries rate limits, preserves its validator, and honors Retry-After", async () => {
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
      assert.ok(error instanceof AshbyFetchError);
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
      assert.ok(error instanceof AshbyFetchError);
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
        assert.ok(error instanceof AshbyFetchError);
        assert.match(error.message, /timeoutMs/);
        return true;
      },
    );
  }
  assert.equal(attempts, 0);
});

test("fetch caps concurrent Ashby board requests at the registered policy", async () => {
  let active = 0;
  let maximumActive = 0;
  const fetcher = createAshbyFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: ashbySourceConfig.maxConcurrentRequests,
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

  const requests = [
    "permitflow-a",
    "permitflow-b",
    "permitflow-c",
    "permitflow-d",
  ].map((atsToken) =>
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
  assert.equal(maximumActive, ashbySourceConfig.maxConcurrentRequests);
});

test("fetch rejects a malformed successful payload without retrying", async () => {
  let attempts = 0;
  const fetcher = testFetcher({
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ jobs: [{ id: "missing-required-fields" }] });
    },
  });

  await assert.rejects(
    fetcher(config({ maxAttempts: 3, retryBaseDelayMs: 0 })),
    (error: unknown) => {
      assert.ok(error instanceof AshbyFetchError);
      assert.match(error.message, /unexpected payload/);
      return true;
    },
  );
  assert.equal(attempts, 1);
});
