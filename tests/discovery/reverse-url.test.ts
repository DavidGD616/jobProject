import assert from "node:assert/strict";
import test from "node:test";

import { extractReverseAtsCandidates, parseAdzunaResponse } from "@/discovery";

test("reverse ATS extraction turns application URLs into probe-ready candidates", () => {
  const candidates = extractReverseAtsCandidates("Apply: https://boards.greenhouse.io/acme/jobs/1 and https://jobs.lever.co/other/2");
  assert.deepEqual(candidates.map((candidate) => [candidate.atsType, candidate.atsToken]), [["greenhouse", "acme"], ["lever", "other"]]);
});

test("Adzuna parsing promotes only company results with official ATS redirects", () => {
  const candidates = parseAdzunaResponse({ results: [
    { company: { display_name: "Acme" }, redirect_url: "https://boards.greenhouse.io/acme/jobs/1", title: "Engineer" },
    { company: { display_name: "Acme" }, redirect_url: "https://example.com/acme", title: "Other" },
    { company: { display_name: "No URL" }, title: "Engineer" },
  ] });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.atsToken, "acme");
});
