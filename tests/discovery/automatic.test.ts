import assert from "node:assert/strict";
import test from "node:test";

import {
  discoverAutomaticCandidates,
  runBulkProbe,
} from "@/discovery";
import type {
  CandidateCompany,
  DiscoveryVerifier,
  ProbeResult,
} from "@/discovery";

const profile = {
  titleAliases: ["Staff software engineer"],
  resumeJson: {
    location: "Oakland, CA",
    experience: [{ title: "Software engineer" }],
  },
  preferences: { locations: ["San Francisco, CA"] },
};

function emptyResult(candidate: CandidateCompany): ProbeResult {
  return { candidate, attempts: [], company: null };
}

test("profile-driven Adzuna candidates retain ATS hints and go through the shared verifier", async () => {
  let receivedSearch:
    | { query: string; location?: string; country?: string }
    | undefined;
  const output = await discoverAutomaticCandidates(
    {
      profile,
      environment: {
        ADZUNA_APP_ID: "test-app",
        ADZUNA_API_KEY: "test-key",
      },
    },
    {
      discoverHnHiring: async () => [{
        name: "HN Company",
        atsType: "greenhouse",
        atsToken: "hn-company",
        discoveredVia: "hn_hiring",
      }],
      searchAdzuna: async (options) => {
        receivedSearch = options;
        return [{
          name: "Adzuna Company",
          atsType: "lever",
          atsToken: "adzuna-company",
          slugHint: "adzuna-company",
          discoveredVia: "adzuna_reverse_url",
        }];
      },
    },
  );

  assert.deepEqual(receivedSearch, {
    appId: "test-app",
    apiKey: "test-key",
    query: "Staff software engineer",
    location: "San Francisco, CA",
    country: "us",
  });
  assert.deepEqual(output.sources.adzuna, {
    status: "used",
    candidates: 1,
    query: "Staff software engineer",
    location: "San Francisco, CA",
    country: "us",
  });

  const probed: CandidateCompany[] = [];
  const verifier: DiscoveryVerifier = {
    async probe(candidate) {
      probed.push(candidate);
      return emptyResult(candidate);
    },
    async verify(candidate) {
      return emptyResult(candidate).company;
    },
  };
  await runBulkProbe(output.candidates, { verifier, maxCandidatesInFlight: 1 });

  assert.deepEqual(probed, output.candidates);
  assert.deepEqual(probed[1], {
    name: "Adzuna Company",
    atsType: "lever",
    atsToken: "adzuna-company",
    slugHint: "adzuna-company",
    discoveredVia: "adzuna_reverse_url",
  });
});

test("missing Adzuna credentials leave automatic HN discovery available", async () => {
  let adzunaCalled = false;
  const output = await discoverAutomaticCandidates(
    { profile, environment: {} },
    {
      discoverHnHiring: async () => [{ name: "HN Company", discoveredVia: "hn_hiring" }],
      searchAdzuna: async () => {
        adzunaCalled = true;
        return [];
      },
    },
  );

  assert.equal(adzunaCalled, false);
  assert.deepEqual(output.sources.adzuna, {
    status: "skipped_missing_credentials",
    candidates: 0,
  });
  assert.deepEqual(output.candidates, [{ name: "HN Company", discoveredVia: "hn_hiring" }]);
});

test("an Adzuna failure degrades to the independent HN source", async () => {
  const output = await discoverAutomaticCandidates(
    {
      profile,
      environment: {
        ADZUNA_APP_ID: "test-app",
        ADZUNA_API_KEY: "test-key",
      },
    },
    {
      discoverHnHiring: async () => [{ name: "HN Company", discoveredVia: "hn_hiring" }],
      searchAdzuna: async () => {
        throw new Error("upstream unavailable");
      },
    },
  );

  assert.deepEqual(output.sources.adzuna, { status: "failed", candidates: 0 });
  assert.deepEqual(output.candidates, [{ name: "HN Company", discoveredVia: "hn_hiring" }]);
});
