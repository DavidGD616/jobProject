import assert from "node:assert/strict";
import test from "node:test";

import { createDiscoveryVerifier, runBulkProbe } from "@/discovery";
import { allowAllRobotsPolicy } from "@/sources";
import type {
  CandidateCompany,
  DiscoveryVerifier,
  ProbeResult,
} from "@/discovery";

function candidate(name: string): CandidateCompany {
  return { name, discoveredVia: "probe" };
}

function result(candidateValue: CandidateCompany, slug: string): ProbeResult {
  return {
    candidate: candidateValue,
    attempts: [],
    company: {
      name: candidateValue.name,
      slug,
      atsType: "greenhouse",
      atsToken: slug,
      careersUrl: `https://boards.greenhouse.io/${slug}`,
      discoveredVia: candidateValue.discoveredVia,
      jobCount: 1,
    },
  };
}

test("runBulkProbe bounds candidate work and deduplicates verified slugs", async () => {
  let active = 0;
  let maximumActive = 0;
  const verifier: DiscoveryVerifier = {
    async probe(candidateValue) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return result(candidateValue, candidateValue.name === "Duplicate" ? "same" : candidateValue.name.toLowerCase());
    },
    async verify(candidateValue) {
      return (await this.probe(candidateValue)).company;
    },
  };

  const output = await runBulkProbe(
    [candidate("Acme"), candidate("Duplicate"), candidate("Other"), candidate("Duplicate")],
    { verifier, maxCandidatesInFlight: 2 },
  );

  assert.equal(output.candidates, 4);
  assert.equal(output.results.length, 4);
  assert.equal(maximumActive, 2);
  assert.deepEqual(
    output.verified.map((company) => company.slug),
    ["acme", "same", "other"],
  );
  assert.equal(output.processed, 4);
  assert.deepEqual(output.pausedAtsTypes, []);
});

test("runBulkProbe keeps ATS tokens separate from company identity", async () => {
  const verifier = createDiscoveryVerifier(
    {
      timeoutMs: 5_000,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
      maxConsecutiveFailuresPerAts: 2,
      maxConcurrentRequestsPerAts: 1,
      minRequestIntervalMs: 0,
      userAgent: "job-hunt-agent-test/1.0 (+https://example.test/contact)",
    },
    {
      robotsPolicy: allowAllRobotsPolicy,
      fetchImpl: async (input) =>
        String(input).includes("lever")
          ? new Response(JSON.stringify([]))
          : new Response(JSON.stringify({ jobs: [] })),
    },
  );

  const output = await runBulkProbe(
    [
      {
        name: "Alpha Labs",
        atsType: "greenhouse",
        atsToken: "shared-token",
        discoveredVia: "probe",
      },
      {
        name: "Beta Systems",
        atsType: "lever",
        atsToken: "shared-token",
        discoveredVia: "probe",
      },
    ],
    { verifier, maxCandidatesInFlight: 1 },
  );

  assert.equal(output.verified.length, 2);
  assert.deepEqual(
    output.verified.map((company) => ({
      slug: company.slug,
      atsToken: company.atsToken,
    })),
    [
      { slug: "alpha-labs", atsToken: "shared-token" },
      { slug: "beta-systems", atsToken: "shared-token" },
    ],
  );
});

test("runBulkProbe stops dispatching after an ATS is paused", async () => {
  let requests = 0;
  const verifier = createDiscoveryVerifier(
    {
      timeoutMs: 5_000,
      maxAttempts: 1,
      retryBaseDelayMs: 0,
      maxConsecutiveFailuresPerAts: 2,
      maxConcurrentRequestsPerAts: 1,
      minRequestIntervalMs: 0,
      userAgent: "job-hunt-agent-test/1.0 (+https://example.test/contact)",
    },
    {
      robotsPolicy: allowAllRobotsPolicy,
      fetchImpl: async () => {
        requests += 1;
        return new Response(null, { status: 429 });
      },
    },
  );

  const output = await runBulkProbe(
    ["one", "two", "three"].map((name) => ({
      name,
      atsType: "greenhouse" as const,
      atsToken: name,
      discoveredVia: "probe",
    })),
    { verifier, maxCandidatesInFlight: 1 },
  );

  assert.equal(output.processed, 2);
  assert.equal(output.results.length, 2);
  assert.deepEqual(output.pausedAtsTypes, ["greenhouse"]);
  assert.equal(requests, 2);
});
