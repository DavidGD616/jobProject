import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "@/ingest/cli";

test("fetch CLI accepts repeatable sources and explicit request controls", () => {
  assert.deepEqual(
    parseArgs([
      "--source",
      "greenhouse",
      "--source=lever",
      "--force",
      "--timeout-ms",
      "12000",
    ]),
    {
      force: true,
      sourceIds: ["greenhouse", "lever"],
      timeoutMs: 12_000,
      watch: false,
      watchIntervalMs: 60_000,
      help: false,
    },
  );
});

test("fetch CLI rejects unsafe watch intervals and unknown switches", () => {
  assert.throws(
    () => parseArgs(["--watch", "--interval-ms", "9999"]),
    /at least 10000/,
  );
  assert.throws(() => parseArgs(["--not-a-real-option"]), /Unknown option/);
});
