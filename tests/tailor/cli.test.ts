import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "@/tailor/cli";

test("tailor CLI accepts one direct job or one queued request", () => {
  assert.deepEqual(parseArgs(["--job-id", "42"]), { jobId: 42, next: false, clearAll: false, help: false });
  assert.deepEqual(parseArgs(["--next"]), { jobId: null, next: true, clearAll: false, help: false });
  assert.deepEqual(parseArgs(["--clear-all"]), { jobId: null, next: false, clearAll: true, help: false });
  assert.throws(() => parseArgs([]), /exactly one/);
  assert.throws(() => parseArgs(["--next", "--job-id", "42"]), /exactly one/);
  assert.throws(() => parseArgs(["--next", "--clear-all"]), /exactly one/);
  assert.throws(() => parseArgs(["--job-id", "nope"]), /positive integer/);
});
