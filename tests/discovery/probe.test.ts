import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createDiscoveryVerifier,
  createNegativeProbeCache,
} from "@/discovery";
import type {
  CandidateCompany,
  DiscoveryProbeConfig,
  DiscoveryProbeDependencies,
} from "@/discovery";
import { companySlug, slugVariants } from "@/discovery";
import { allowAllRobotsPolicy, createSourceRequestLimiter } from "@/sources";

const greenhouseFixture = JSON.parse(
  readFileSync("tests/fixtures/discovery/greenhouse-board.json", "utf8"),
);
const leverFixture = JSON.parse(
  readFileSync("tests/fixtures/discovery/lever-board.json", "utf8"),
);
const ashbyFixture = JSON.parse(
  readFileSync("tests/fixtures/discovery/ashby-board.json", "utf8"),
);

const probeConfig: Partial<DiscoveryProbeConfig> = {
  timeoutMs: 5_000,
  maxAttempts: 2,
  retryBaseDelayMs: 0,
  maxConcurrentRequestsPerAts: 2,
  minRequestIntervalMs: 0,
  userAgent: "job-hunt-agent-test/1.0 (+https://example.test/contact)",
};

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function noDelayLimiter() {
  return createSourceRequestLimiter({
    maxConcurrentRequests: 2,
    minRequestIntervalMs: 0,
  });
}

function limiters() {
  return {
    greenhouse: noDelayLimiter(),
    lever: noDelayLimiter(),
    ashby: noDelayLimiter(),
  };
}

function candidate(overrides: Partial<CandidateCompany> = {}): CandidateCompany {
  return {
    name: "Acme Corp",
    discoveredVia: "probe",
    ...overrides,
  };
}

function testVerifier(
  config: Partial<DiscoveryProbeConfig> = probeConfig,
  dependencies: DiscoveryProbeDependencies = {},
) {
  return createDiscoveryVerifier(config, {
    robotsPolicy: allowAllRobotsPolicy,
    ...dependencies,
  });
}

test("slugVariants tries compact, hyphenated, and legal-suffix-stripped forms", () => {
  assert.deepEqual(slugVariants("Acme Corp, Inc."), [
    "acmecorpinc",
    "acme-corp-inc",
    "acmecorp",
    "acme-corp",
    "acme",
  ]);
  assert.deepEqual(slugVariants("Acme S.L."), ["acmesl", "acme-s-l", "acme"]);
  assert.deepEqual(slugVariants("Acme L.L.C."), ["acmellc", "acme-l-l-c", "acme"]);
  assert.equal(companySlug("Acme Corp, Inc."), "acme");
});

test("verify accepts a valid Greenhouse board and returns its canonical URL", async () => {
  const requestedUrls: string[] = [];
  let requestedHeaders: Headers | undefined;
  const verifier = testVerifier(probeConfig, {
    limiters: limiters(),
    fetchImpl: async (input, init) => {
      requestedUrls.push(String(input));
      requestedHeaders = new Headers(init?.headers);
      return jsonResponse(greenhouseFixture);
    },
  });

  const result = await verifier.verify(
    candidate({ name: "Acme", atsType: "greenhouse", atsToken: "acme" }),
  );

  assert.deepEqual(result, {
    name: "Acme",
    slug: "acme",
    atsType: "greenhouse",
    atsToken: "acme",
    careersUrl: "https://boards.greenhouse.io/acme",
    discoveredVia: "probe",
    jobCount: 1,
  });
  assert.deepEqual(requestedUrls, [
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
  ]);
  assert.equal(
    requestedHeaders?.get("user-agent"),
    "job-hunt-agent-test/1.0 (+https://example.test/contact)",
  );
});

test("verify validates Lever and Ashby response shapes", async () => {
  const cases = [
    {
      atsType: "lever" as const,
      payload: leverFixture,
      expectedUrl: "https://api.lever.co/v0/postings/acme?mode=json",
      expectedCareersUrl: "https://jobs.lever.co/acme",
    },
    {
      atsType: "ashby" as const,
      payload: ashbyFixture,
      expectedUrl: "https://api.ashbyhq.com/posting-api/job-board/acme",
      expectedCareersUrl: "https://jobs.ashbyhq.com/acme",
    },
  ];

  for (const testCase of cases) {
    let requestedUrl = "";
    const verifier = testVerifier(probeConfig, {
      limiters: limiters(),
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return jsonResponse(testCase.payload);
      },
    });

    const result = await verifier.verify(
      candidate({ atsType: testCase.atsType, atsToken: "acme" }),
    );

    assert.equal(result?.atsType, testCase.atsType);
    assert.equal(result?.jobCount, 1);
    assert.equal(result?.careersUrl, testCase.expectedCareersUrl);
    assert.equal(requestedUrl, testCase.expectedUrl);
  }
});

test("verify falls through slug variants and records a cached 404", async () => {
  let calls = 0;
  const negativeCache = createNegativeProbeCache();
  const verifier = testVerifier(probeConfig, {
    negativeCache,
    limiters: limiters(),
    fetchImpl: async () => {
      calls += 1;
      return new Response(null, { status: 404 });
    },
  });

  const first = await verifier.probe(
    candidate({ atsType: "greenhouse", name: "Missing Corp" }),
  );
  const second = await verifier.probe(
    candidate({ atsType: "greenhouse", name: "Missing Corp" }),
  );

  assert.equal(first.company, null);
  assert.equal(first.attempts.every((attempt) => attempt.outcome === "not_found"), true);
  assert.equal(second.company, null);
  assert.equal(second.attempts.every((attempt) => attempt.outcome === "cached_miss"), true);
  assert.equal(calls, first.attempts.length);
});

test("verify retries 429 and honors Retry-After without retrying malformed payloads", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const verifier = testVerifier(probeConfig, {
    limiters: limiters(),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(null, {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return jsonResponse(greenhouseFixture);
    },
    sleep: async (ms) => {
      delays.push(ms);
    },
  });

  const result = await verifier.verify(
    candidate({ atsType: "greenhouse", atsToken: "acme" }),
  );

  assert.equal(result?.jobCount, 1);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [0]);

  let malformedAttempts = 0;
  const malformedVerifier = testVerifier(probeConfig, {
    limiters: limiters(),
    fetchImpl: async () => {
      malformedAttempts += 1;
      return jsonResponse({ jobs: "not-an-array" });
    },
    sleep: async () => {
      throw new Error("malformed payload should not retry");
    },
  });
  const malformed = await malformedVerifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "bad" }),
  );

  assert.equal(malformed.company, null);
  assert.equal(malformed.attempts[0]?.outcome, "invalid_payload");
  assert.equal(malformedAttempts, 1);
});

test("repeated invalid 2xx payloads pause an ATS host", async () => {
  let requests = 0;
  const verifier = testVerifier(
    {
      ...probeConfig,
      maxAttempts: 1,
      maxConsecutiveFailuresPerAts: 2,
    },
    {
      limiters: limiters(),
      fetchImpl: async () => {
        requests += 1;
        return jsonResponse({ error: "WAF challenge" });
      },
    },
  );

  const first = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "first" }),
  );
  const second = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "second" }),
  );
  const third = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "third" }),
  );

  assert.equal(first.attempts[0]?.outcome, "invalid_payload");
  assert.equal(second.attempts[0]?.outcome, "paused");
  assert.equal(third.attempts[0]?.outcome, "paused");
  assert.equal(requests, 2);
});

test("verify uses the per-ATS concurrency limiter", async () => {
  let active = 0;
  let maximumActive = 0;
  const verifier = testVerifier(probeConfig, {
    limiters: {
      greenhouse: createSourceRequestLimiter({
        maxConcurrentRequests: 1,
        minRequestIntervalMs: 0,
      }),
      lever: noDelayLimiter(),
      ashby: noDelayLimiter(),
    },
    fetchImpl: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return jsonResponse(greenhouseFixture);
    },
  });

  await Promise.all(
    ["one", "two", "three"].map((atsToken) =>
      verifier.verify(
        candidate({ atsType: "greenhouse", atsToken }),
      ),
    ),
  );

  assert.equal(maximumActive, 1);
});

test("verify pauses an ATS after repeated retryable failures", async () => {
  let requests = 0;
  const verifier = testVerifier(
    {
      ...probeConfig,
      maxAttempts: 1,
      maxConsecutiveFailuresPerAts: 2,
    },
    {
      limiters: limiters(),
      fetchImpl: async () => {
        requests += 1;
        return new Response(null, { status: 503 });
      },
      sleep: async () => {},
    },
  );

  const first = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "first" }),
  );
  const second = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "second" }),
  );
  const third = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "third" }),
  );

  assert.equal(first.attempts[0]?.outcome, "failed");
  assert.equal(second.attempts[0]?.outcome, "paused");
  assert.equal(third.attempts[0]?.outcome, "paused");
  assert.equal(requests, 2);
});

test("a paused host stops remaining ATS and slug probes for the candidate", async () => {
  let requests = 0;
  const verifier = testVerifier(
    {
      ...probeConfig,
      maxAttempts: 1,
      maxConsecutiveFailuresPerAts: 1,
    },
    {
      limiters: limiters(),
      fetchImpl: async () => {
        requests += 1;
        return new Response(null, { status: 503 });
      },
    },
  );

  const result = await verifier.probe(candidate({ name: "Alpha Labs Corp" }));

  assert.deepEqual(
    result.attempts.map((attempt) => attempt.atsType),
    ["greenhouse"],
  );
  assert.equal(result.attempts[0]?.outcome, "paused");
  assert.equal(requests, 1);
});

test("a blocked ATS response pauses the host immediately", async () => {
  let requests = 0;
  const verifier = testVerifier(probeConfig, {
    limiters: limiters(),
    fetchImpl: async () => {
      requests += 1;
      return new Response(null, { status: 403 });
    },
  });

  const first = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "first" }),
  );
  const second = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "second" }),
  );

  assert.equal(first.attempts[0]?.outcome, "paused");
  assert.equal(second.attempts[0]?.outcome, "paused");
  assert.equal(requests, 1);
});

test("probe checks robots.txt before an ATS API request", async () => {
  const requestedUrls: string[] = [];
  const verifier = createDiscoveryVerifier(
    { ...probeConfig, maxAttempts: 1 },
    {
      limiters: limiters(),
      fetchImpl: async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith("/robots.txt")) {
          return new Response("User-agent: *\nDisallow: /v1/boards/blocked\n", {
            headers: { "content-type": "text/plain" },
          });
        }
        throw new Error("board API must not be reached when robots disallows it");
      },
    },
  );

  const result = await verifier.probe(
    candidate({ atsType: "greenhouse", atsToken: "blocked" }),
  );

  assert.equal(result.attempts[0]?.outcome, "paused");
  assert.deepEqual(requestedUrls, ["https://boards-api.greenhouse.io/robots.txt"]);
});
