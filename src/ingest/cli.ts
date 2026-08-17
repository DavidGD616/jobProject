import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { db, sqlite } from "@/db";
import type { JobHuntDatabase } from "@/db";
import { runSourcePolls } from "@/ingest/poller";
import type { PollableSource } from "@/ingest/poller";
import { delay, pollableSources } from "@/sources";

const DEFAULT_WATCH_INTERVAL_MS = 60_000;
const MIN_WATCH_INTERVAL_MS = 10_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

interface CliOptions {
  force: boolean;
  sourceIds: string[];
  timeoutMs: number | undefined;
  watch: boolean;
  watchIntervalMs: number;
  help: boolean;
}

interface CliDependencies {
  database?: JobHuntDatabase;
  sources?: readonly PollableSource[];
  sleep?: typeof delay;
  output?: (value: string) => void;
  now?: () => Date;
}

function usage(): string {
  return `Usage: pnpm jobs:fetch -- [options]

Poll due, active public ATS boards and ingest their current postings into the
local SQLite database. A 304 updates transport state only; a fetched snapshot
updates jobs and runs the two-pass staleness sweep.

Options:
  --source <id>         Poll one source (repeatable: greenhouse, lever, ashby)
  --force               Ignore persisted cadence for this run
  --timeout-ms <n>      Per-board request timeout (default: 20000)
  --watch               Keep polling due work locally (default interval: 60000ms)
  --interval-ms <n>     Delay between --watch scans (minimum: 10000)
  --help, -h            Show this help
`;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return parsed;
}

export function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    force: false,
    sourceIds: [],
    timeoutMs: undefined,
    watch: false,
    watchIntervalMs: DEFAULT_WATCH_INTERVAL_MS,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--force") {
      options.force = true;
    } else if (argument === "--watch") {
      options.watch = true;
    } else if (argument === "--source") {
      const source = args[++index];
      if (!source) throw new Error("--source requires a source ID");
      options.sourceIds.push(source);
    } else if (argument?.startsWith("--source=")) {
      const source = argument.slice("--source=".length);
      if (!source) throw new Error("--source requires a source ID");
      options.sourceIds.push(source);
    } else if (argument === "--timeout-ms") {
      options.timeoutMs = positiveInteger(
        args[++index] ?? "",
        "--timeout-ms",
      );
    } else if (argument?.startsWith("--timeout-ms=")) {
      options.timeoutMs = positiveInteger(
        argument.slice("--timeout-ms=".length),
        "--timeout-ms",
      );
    } else if (argument === "--interval-ms") {
      options.watchIntervalMs = positiveInteger(
        args[++index] ?? "",
        "--interval-ms",
      );
    } else if (argument?.startsWith("--interval-ms=")) {
      options.watchIntervalMs = positiveInteger(
        argument.slice("--interval-ms=".length),
        "--interval-ms",
      );
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.timeoutMs && options.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be at most ${MAX_TIMEOUT_MS}`);
  }
  if (options.watch && options.watchIntervalMs < MIN_WATCH_INTERVAL_MS) {
    throw new Error(`--interval-ms must be at least ${MIN_WATCH_INTERVAL_MS}`);
  }
  return options;
}

function validateSources(
  requestedIds: readonly string[],
  sources: readonly PollableSource[],
): string[] {
  const known = new Set(sources.map((source) => source.id));
  const requested = [...new Set(requestedIds)];
  const unknown = requested.filter((source) => !known.has(source));
  if (unknown.length > 0) {
    throw new Error(`Unknown source: ${unknown.join(", ")}`);
  }
  return requested;
}

/** Run one due-work scan; exported so the CLI behavior remains testable. */
export async function runOnce(
  options: Pick<CliOptions, "force" | "sourceIds" | "timeoutMs">,
  dependencies: Required<Pick<CliDependencies, "database" | "sources" | "now">>,
) {
  return runSourcePolls(dependencies.database, {
    sources: dependencies.sources,
    sourceIds: options.sourceIds.length > 0 ? options.sourceIds : undefined,
    force: options.force,
    timeoutMs: options.timeoutMs,
    now: dependencies.now,
  });
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  dependencies: CliDependencies = {},
): Promise<number> {
  const options = parseArgs(args);
  const output = dependencies.output ?? console.log;
  if (options.help) {
    output(usage());
    return 0;
  }

  const sources = dependencies.sources ?? pollableSources;
  const sourceIds = validateSources(options.sourceIds, sources);
  const database = dependencies.database ?? db;
  const now = dependencies.now ?? (() => new Date());
  const sleep = dependencies.sleep ?? delay;
  const signalController = new AbortController();
  const stopWatching = () => signalController.abort();

  process.once("SIGINT", stopWatching);
  try {
    do {
      const summary = await runOnce(
        { ...options, sourceIds },
        { database, sources, now },
      );
      output(JSON.stringify(summary, null, 2));
      if (!options.watch) break;
      await sleep(options.watchIntervalMs, signalController.signal);
    } while (!signalController.signal.aborted);
    return 0;
  } catch (cause) {
    if (signalController.signal.aborted) return 0;
    throw cause;
  } finally {
    process.removeListener("SIGINT", stopWatching);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  ).finally(() => {
    sqlite.close();
  });
}
