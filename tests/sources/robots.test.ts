import assert from "node:assert/strict";
import test from "node:test";

import {
  createSourceRequestLimiter,
  fetchRobotsPolicy,
  parseRobotsPolicy,
} from "@/sources";

test("robots policy chooses the most-specific rule and honors crawl delay", () => {
  const policy = parseRobotsPolicy(
    [
      "User-agent: *",
      "Disallow: /private",
      "Allow: /private/open",
      "Crawl-delay: 0.5",
      "",
      "User-agent: job-hunt-agent",
      "Disallow: /v1/*/blocked$",
      "Allow: /v1/public",
      "Crawl-delay: 1",
    ].join("\n"),
    "job-hunt-agent/0.1 (+https://example.test/contact)",
  );

  // A specific user-agent group does not inherit wildcard restrictions.
  assert.equal(policy.allows("https://example.test/private"), true);
  assert.equal(policy.allows("https://example.test/v1/public"), true);
  assert.equal(policy.allows("https://example.test/v1/one/blocked"), false);
  assert.equal(policy.allows("https://example.test/v1/one/blocked/more"), true);
  assert.equal(policy.crawlDelayMs, 1_000);
});

test("a blank Disallow is an allow-all rule", () => {
  const policy = parseRobotsPolicy(
    "User-agent: *\nDisallow:\n",
    "job-hunt-agent/0.1",
  );

  assert.equal(policy.allows("https://example.test/any/path"), true);
});

test("robots policy uses the source limiter and treats an unavailable file as unrestricted", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  const policy = await fetchRobotsPolicy(
    {
      targetUrl: "https://example.test/api/jobs?department=engineering",
      userAgent: "job-hunt-agent-test/1.0 (+https://example.test/contact)",
      timeoutMs: 5_000,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
    },
    {
      requestLimiter: createSourceRequestLimiter({
        maxConcurrentRequests: 1,
        minRequestIntervalMs: 0,
      }),
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        return new Response(null, { status: 404 });
      },
    },
  );

  assert.equal(requestedUrl, "https://example.test/robots.txt");
  assert.equal(requestedHeaders?.get("accept"), "text/plain");
  assert.equal(policy.allows("https://example.test/api/jobs"), true);
});

test("a learned Crawl-delay spaces the API request after robots.txt", async () => {
  const limiter = createSourceRequestLimiter({
    maxConcurrentRequests: 1,
    minRequestIntervalMs: 0,
  });
  const policy = await fetchRobotsPolicy(
    {
      targetUrl: "https://example.test/api/jobs",
      userAgent: "job-hunt-agent-test/1.0",
      timeoutMs: 5_000,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
    },
    {
      requestLimiter: limiter,
      fetchImpl: async () =>
        new Response("User-agent: *\nCrawl-delay: 0.03\n", {
          headers: { "content-type": "text/plain" },
        }),
    },
  );

  limiter.raiseMinRequestIntervalMs(policy.crawlDelayMs);
  const startedAt = Date.now();
  await limiter.waitForRequestSlot();

  assert.ok(Date.now() - startedAt >= 20);
});
