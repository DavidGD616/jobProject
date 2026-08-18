import assert from "node:assert/strict";
import test from "node:test";

import {
  extractReverseAtsCandidates,
  AdzunaDiscoveryError,
  parseAdzunaResponse,
  searchAdzuna,
} from "@/discovery";
import { allowAllRobotsPolicy, createSourceRequestLimiter } from "@/sources";

test("reverse ATS extraction turns application URLs into probe-ready candidates", () => {
  const candidates = extractReverseAtsCandidates("Apply: https://boards.greenhouse.io/acme/jobs/1 and https://jobs.lever.co/other/2");
  assert.deepEqual(candidates.map((candidate) => [candidate.atsType, candidate.atsToken]), [["greenhouse", "acme"], ["lever", "other"]]);
});

test("Adzuna parsing promotes an official reverse URL over a generic result", () => {
  const candidates = parseAdzunaResponse({ results: [
    { company: { display_name: "Acme" }, redirect_url: "https://example.com/acme", title: "Other" },
    { company: { display_name: "Acme" }, redirect_url: "https://boards.greenhouse.io/acme/jobs/1", title: "Engineer" },
    { company: { display_name: "No URL" }, title: "Engineer" },
  ] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.atsToken, "acme");
  assert.equal(candidates[0]?.discoveredVia, "adzuna_reverse_url");
});

test("Adzuna search forwards the profile-derived location under the shared request policy", async () => {
  let requestedUrl = "";
  const candidates = await searchAdzuna(
    {
      appId: "test-app",
      apiKey: "test-key",
      country: "us",
      query: "Staff software engineer",
      location: "San Francisco, CA",
    },
    {
      robotsPolicy: allowAllRobotsPolicy,
      requestLimiter: createSourceRequestLimiter({
        maxConcurrentRequests: 1,
        minRequestIntervalMs: 0,
      }),
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({ results: [] }));
      },
    },
  );

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get("what"), "Staff software engineer");
  assert.equal(url.searchParams.get("where"), "San Francisco, CA");
  assert.equal(candidates.length, 0);
});

test("Adzuna errors never include query credentials or profile search terms", async () => {
  await assert.rejects(
    searchAdzuna(
      {
        appId: "test-app",
        apiKey: "not-for-logs",
        query: "Private role",
        location: "Private location",
      },
      {
        robotsPolicy: allowAllRobotsPolicy,
        requestLimiter: createSourceRequestLimiter({
          maxConcurrentRequests: 1,
          minRequestIntervalMs: 0,
        }),
        fetchImpl: async () => new Response(null, { status: 401 }),
      },
    ),
    (cause: unknown) => {
      assert.ok(cause instanceof AdzunaDiscoveryError);
      assert.doesNotMatch(cause.url, /test-app|not-for-logs|Private/i);
      return true;
    },
  );
});
