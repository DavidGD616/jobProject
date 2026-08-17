import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  allowAllRobotsPolicy,
  createSourceRequestLimiter,
} from "@/sources";
import type { SourceRequestLimiter } from "@/sources";
import {
  adapter,
  createLeverFetcher,
  LeverFetchError,
  leverResponseSchema,
  leverSourceConfig,
  normalize,
  sourceId,
} from "@/sources/lever";
import type {
  LeverFetchConfig,
  LeverFetchDependencies,
} from "@/sources/lever";

const fixture = leverResponseSchema.parse(
  JSON.parse(readFileSync("tests/fixtures/lever/jobs.json", "utf8")),
);

function config(overrides: Partial<LeverFetchConfig> = {}): LeverFetchConfig {
  return {
    company: {
      id: 1,
      name: "Atom Computing",
      atsType: "lever",
      atsToken: "atomcomputing",
      careersUrl: "https://jobs.lever.co/atomcomputing",
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

function testFetcher(overrides: LeverFetchDependencies = {}) {
  return createLeverFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: 2,
      minRequestIntervalMs: 0,
    }),
    robotsPolicy: allowAllRobotsPolicy,
    sleep: async () => {},
    ...overrides,
  });
}

test("fixture parses as a Lever postings response", () => {
  assert.equal(fixture.length, 3);
  assert.equal(fixture[0]?.id, "929030c6-3ecc-46ce-96a1-81ac1eed244b");
});

test("normalization maps Lever fields, structured salary, and remote metadata", () => {
  const onsitePosting = normalize(fixture[0]!);
  const missingSalaryPosting = normalize(fixture[1]!);
  const multiLocationPosting = normalize(fixture[2]!);
  const remotePosting = normalize({
    ...fixture[0]!,
    workplaceType: "remote",
  });
  const locationDerivedRemotePosting = normalize({
    ...fixture[0]!,
    workplaceType: null,
    categories: {
      ...fixture[0]!.categories,
      location: null,
      allLocations: ["Remote (US)"],
    },
  });
  const bodyFallbackPosting = normalize({
    ...fixture[0]!,
    description: "",
    descriptionBody: "<p>Fallback description body.</p>",
    descriptionPlain: null,
    lists: [],
    opening: "",
    additional: "",
  });

  assert.equal(onsitePosting.url, fixture[0]!.hostedUrl);
  assert.equal(onsitePosting.title, "Facilities Technician");
  assert.equal(onsitePosting.titleNorm, "facilities technician");
  assert.equal(onsitePosting.location, "Boulder, CO");
  assert.equal(onsitePosting.remoteType, "onsite");
  assert.equal(onsitePosting.postedAt?.toISOString(), "2026-07-29T21:00:11.414Z");
  assert.equal(onsitePosting.salaryMin, 75_000);
  assert.equal(onsitePosting.salaryMax, 100_000);
  assert.equal(onsitePosting.salaryPeriod, "year");
  assert.equal(onsitePosting.currency, "USD");
  assert.match(onsitePosting.description, /Facilities Responsibilities/);
  assert.match(onsitePosting.description, /routine and preventive maintenance/);
  assert.match(onsitePosting.description, /base salary range/);
  assert.doesNotMatch(onsitePosting.description, /<[^>]+>/);
  assert.doesNotMatch(onsitePosting.description, /&nbsp;|&lt;|&gt;|&quot;/);

  // Salary is present only in free text for this posting. Leave it for the
  // later heuristic stage rather than treating it as source-supplied data.
  assert.equal(missingSalaryPosting.salaryMin, undefined);
  assert.equal(missingSalaryPosting.salaryMax, undefined);
  assert.equal(missingSalaryPosting.salaryPeriod, undefined);
  assert.equal(missingSalaryPosting.currency, undefined);

  assert.equal(multiLocationPosting.titleNorm, "software engineer - control systems");
  assert.equal(multiLocationPosting.location, "Boulder, CO / Austin, TX");
  assert.equal(multiLocationPosting.remoteType, "hybrid");
  assert.equal(
    multiLocationPosting.postedAt?.toISOString(),
    "2026-07-24T20:39:51.915Z",
  );
  assert.equal(remotePosting.remoteType, "remote");
  assert.equal(locationDerivedRemotePosting.location, "Remote (US)");
  assert.equal(locationDerivedRemotePosting.remoteType, "remote");
  assert.equal(bodyFallbackPosting.description, "Fallback description body.");
});

test("normalization is deterministic and does not mutate raw Lever data", () => {
  const raw = fixture[0]!;
  const before = structuredClone(raw);

  const first = normalize(raw);
  const second = normalize(raw);

  assert.deepEqual(raw, before);
  assert.deepEqual(first, second);
});

test("sourceId uses the stable upstream Lever job ID", () => {
  const raw = fixture[0]!;

  assert.equal(sourceId(raw), "929030c6-3ecc-46ce-96a1-81ac1eed244b");
  assert.equal(
    sourceId({ ...raw, description: "<p>Updated description</p>" }),
    "929030c6-3ecc-46ce-96a1-81ac1eed244b",
  );
});

test("Lever has a polite Tier 1 source policy", () => {
  assert.equal(adapter.normalize, normalize);
  assert.equal(leverSourceConfig.cadenceMs, 6 * 60 * 60 * 1_000);
  assert.equal(leverSourceConfig.maxConcurrentRequests, 2);
  assert.equal(leverSourceConfig.minRequestIntervalMs, 1_000);
  assert.match(
    leverSourceConfig.userAgent,
    /github\.com\/DavidGD616\/jobProject\/issues/,
  );
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
    "https://api.lever.co/v0/postings/atomcomputing?mode=json",
  );
  assert.equal(requestedHeaders?.get("accept"), "application/json");
  assert.equal(
    requestedHeaders?.get("user-agent"),
    "job-hunt-agent-test/1.0 (+https://example.test/contact)",
  );
  assert.equal(requestedHeaders?.get("if-none-match"), null);
});

test("fetch checks robots.txt before requesting a Lever board", async () => {
  const requestedUrls: string[] = [];
  const fetcher = createLeverFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: 1,
      minRequestIntervalMs: 0,
    }),
    fetchImpl: async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/robots.txt")) {
        return new Response(
          "User-agent: *\nDisallow: /v0/postings/atomcomputing\n",
          { headers: { "content-type": "text/plain" } },
        );
      }
      throw new Error("board API must not be reached when robots disallows it");
    },
  });

  await assert.rejects(
    () => fetcher(config()),
    (error: unknown) =>
      error instanceof LeverFetchError && /robots\.txt disallows/.test(error.message),
  );
  assert.deepEqual(requestedUrls, ["https://api.lever.co/robots.txt"]);
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
    fetchImpl: async () => jsonResponse([]),
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
      assert.ok(error instanceof LeverFetchError);
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
      assert.ok(error instanceof LeverFetchError);
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
        assert.ok(error instanceof LeverFetchError);
        assert.match(error.message, /timeoutMs/);
        return true;
      },
    );
  }
  assert.equal(attempts, 0);
});

test("fetch caps concurrent Lever board requests at the registered policy", async () => {
  let active = 0;
  let maximumActive = 0;
  const fetcher = createLeverFetcher({
    requestLimiter: createSourceRequestLimiter({
      maxConcurrentRequests: leverSourceConfig.maxConcurrentRequests,
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

  const requests = ["atom-a", "atom-b", "atom-c", "atom-d"].map(
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
  assert.equal(maximumActive, leverSourceConfig.maxConcurrentRequests);
});

test("fetch rejects a malformed successful payload without retrying", async () => {
  let attempts = 0;
  const fetcher = testFetcher({
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse([{ id: 42, text: "Bad posting" }]);
    },
  });

  await assert.rejects(
    fetcher(config({ maxAttempts: 3, retryBaseDelayMs: 0 })),
    (error: unknown) => {
      assert.ok(error instanceof LeverFetchError);
      assert.match(error.message, /unexpected payload/);
      return true;
    },
  );
  assert.equal(attempts, 1);
});
