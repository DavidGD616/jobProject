import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createNegativeProbeCache,
  loadNegativeProbeCache,
  parseCandidateNames,
  saveNegativeProbeCache,
} from "@/discovery";

test("parseCandidateNames ignores blanks, comments, and duplicate names", () => {
  assert.deepEqual(
    parseCandidateNames(
      "Acme Corp\n\n# from a public seed source\nacme corp # duplicate\nBeta LLC\n",
    ),
    [
      { name: "Acme Corp", discoveredVia: "probe" },
      { name: "Beta LLC", discoveredVia: "probe" },
    ],
  );
});

test("negative probe cache persists 404 keys between runs", () => {
  const directory = mkdtempSync(join(tmpdir(), "job-hunt-discovery-"));
  const path = join(directory, "negative.json");
  const cache = createNegativeProbeCache();
  cache.mark("greenhouse:missing");
  saveNegativeProbeCache(path, cache);

  const loaded = loadNegativeProbeCache(path);
  assert.equal(loaded.has("greenhouse:missing"), true);
  loaded.clear("greenhouse:missing");
  assert.equal(loaded.has("greenhouse:missing"), false);
});
