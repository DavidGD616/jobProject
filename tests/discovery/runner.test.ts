import assert from "node:assert/strict";
import test from "node:test";

import { runBulkProbe } from "@/discovery";
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
});
