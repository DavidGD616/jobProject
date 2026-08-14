import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  fetch as greenhouseFetch,
  GreenhouseFetchError,
  greenhouseResponseSchema,
  normalize,
  sourceId,
} from "@/sources/greenhouse";
import type { GreenhouseFetchConfig } from "@/sources/greenhouse";

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
    userAgent: "job-hunt-agent-test/1.0",
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

test("fixture parses as a Greenhouse Job Board response", () => {
  assert.equal(fixture.jobs.length, 3);
  assert.equal(fixture.meta?.total, 564);
  assert.equal(fixture.jobs[0]?.id, 8_077_887);
});

test("normalize maps Greenhouse fields to the canonical posting shape", () => {
  const posting = normalize(fixture.jobs[0]!);
  const multiOfficePosting = normalize(fixture.jobs[2]!);

  assert.equal(posting.url, fixture.jobs[0]!.absolute_url);
  assert.equal(posting.title, "Account Executive, Bridge");
  assert.equal(posting.titleNorm, "account executive, bridge");
  assert.equal(posting.location, "SF, NYC, SEA, CHI");
  assert.equal(posting.postedAt?.toISOString(), "2026-07-22T17:15:53.000Z");
  assert.match(posting.description, /Who we are/);
  assert.match(posting.description, /Stripe is a financial infrastructure platform/);
  assert.doesNotMatch(posting.description, /<[^>]+>/);
  assert.doesNotMatch(posting.description, /&lt;|&gt;|&quot;/);

  assert.equal(multiOfficePosting.title, "AI Product Manager, Professional Services");
  assert.equal(multiOfficePosting.location, "New York/ San Francisco");
});

test("normalize is deterministic and does not mutate raw Greenhouse data", () => {
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

test("fetch requests the public board endpoint with content and the configured user agent", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl: string | undefined;
  let requestedHeaders: Headers | undefined;

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedHeaders = new Headers(init?.headers);
    return jsonResponse(fixture);
  };

  try {
    const jobs = await greenhouseFetch(config());

    assert.equal(jobs.length, 3);
    assert.equal(
      requestedUrl,
      "https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true",
    );
    assert.equal(requestedHeaders?.get("accept"), "application/json");
    assert.equal(
      requestedHeaders?.get("user-agent"),
      "job-hunt-agent-test/1.0",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetch retries a rate-limited response before returning jobs", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response(null, {
        status: 429,
        headers: { "retry-after": "0" },
      });
    }
    return jsonResponse(fixture);
  };

  try {
    const jobs = await greenhouseFetch(
      config({ maxAttempts: 2, retryBaseDelayMs: 0 }),
    );

    assert.equal(attempts, 2);
    assert.equal(jobs[0]?.id, 8_077_887);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetch rejects a malformed successful payload without retrying", async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;

  globalThis.fetch = async () => {
    attempts += 1;
    return jsonResponse({ jobs: [{ id: "not-a-number" }] });
  };

  try {
    await assert.rejects(
      greenhouseFetch(config({ maxAttempts: 3, retryBaseDelayMs: 0 })),
      (error: unknown) => {
        assert.ok(error instanceof GreenhouseFetchError);
        assert.match(error.message, /unexpected payload/);
        return true;
      },
    );
    assert.equal(attempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
