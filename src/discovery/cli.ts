import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import {
  createNegativeProbeCache,
  createDiscoveryVerifier,
  discoverHnHiring,
  discoveryProbeConfig,
  loadNegativeProbeCache,
  runBulkProbe,
  saveNegativeProbeCache,
  upsertVerifiedCompanies,
} from "./index";

const DEFAULT_CACHE_PATH = "data/discovery-negative-cache.json";
const DEFAULT_REPORT_PATH = "data/discovery-last-run.json";

interface CliOptions {
  hnStoryId?: string;
  maxCandidates?: number;
  cachePath: string;
  reportPath: string;
  refreshCache: boolean;
  help: boolean;
}

function usage(): string {
  return `Usage: pnpm discover:seed -- [options]

Read the latest 36 Hacker News "Who is hiring?" threads, extract
top-level listings with direct official ATS URLs, verify those boards, and
upsert verified companies into SQLite.

Options:
  --hn-story-id <id>  Use a specific HN hiring-thread ID (for reproducible runs)
  --max-candidates <n>
                       Bound this run without changing its automatic source
  --cache <path>      Negative probe cache (default: ${DEFAULT_CACHE_PATH})
  --report <path>     Detailed probe diagnostics (default: ${DEFAULT_REPORT_PATH})
  --refresh-cache     Ignore cached 404s for this run
  --help, -h          Show this help
`;
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    cachePath: DEFAULT_CACHE_PATH,
    reportPath: DEFAULT_REPORT_PATH,
    refreshCache: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--refresh-cache") {
      options.refreshCache = true;
    } else if (argument === "--hn-story-id") {
      options.hnStoryId = args[++index];
      if (!options.hnStoryId) throw new Error("--hn-story-id requires an ID");
    } else if (argument?.startsWith("--hn-story-id=")) {
      options.hnStoryId = argument.slice("--hn-story-id=".length);
    } else if (argument === "--max-candidates") {
      options.maxCandidates = Number(args[++index]);
      if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) {
        throw new Error("--max-candidates requires a positive integer");
      }
    } else if (argument?.startsWith("--max-candidates=")) {
      options.maxCandidates = Number(
        argument.slice("--max-candidates=".length),
      );
      if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) {
        throw new Error("--max-candidates requires a positive integer");
      }
    } else if (argument === "--cache") {
      options.cachePath = args[++index] ?? "";
      if (!options.cachePath) throw new Error("--cache requires a path");
    } else if (argument?.startsWith("--cache=")) {
      options.cachePath = argument.slice("--cache=".length);
    } else if (argument === "--report") {
      options.reportPath = args[++index] ?? "";
      if (!options.reportPath) throw new Error("--report requires a path");
    } else if (argument?.startsWith("--report=")) {
      options.reportPath = argument.slice("--report=".length);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function writeReport(path: string, report: object): void {
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export async function main(args: readonly string[] = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const discoveredCandidates = await discoverHnHiring({
    storyId: options.hnStoryId,
  });
  const candidates = options.maxCandidates
    ? discoveredCandidates.slice(0, options.maxCandidates)
    : discoveredCandidates;
  if (candidates.length === 0) {
    throw new Error(
      "HN hiring threads did not contain any top-level listings with a supported ATS URL and a company heading that matches its board token",
    );
  }

  const negativeCache = options.refreshCache
    ? createNegativeProbeCache()
    : loadNegativeProbeCache(options.cachePath);
  const verifier = createDiscoveryVerifier({}, { negativeCache });
  const result = await runBulkProbe(candidates, {
    verifier,
    maxCandidatesInFlight: discoveryProbeConfig.maxCandidatesInFlight,
  });

  const attempts = result.results.flatMap((probeResult) => probeResult.attempts);
  const count = (outcome: string) =>
    attempts.filter((attempt) => attempt.outcome === outcome).length;
  const summary = {
    discovered: discoveredCandidates.length,
    candidates: result.candidates,
    processed: result.processed,
    verified: result.verified.length,
    attempts: attempts.length,
    notFound: count("not_found"),
    cachedMisses: count("cached_miss"),
    invalidPayloads: count("invalid_payload"),
    failures: count("failed"),
    pausedAtsTypes: result.pausedAtsTypes,
    reportPath: options.reportPath,
  };

  saveNegativeProbeCache(options.cachePath, negativeCache);
  writeReport(options.reportPath, {
    generatedAt: new Date().toISOString(),
    summary,
    verified: result.verified,
    results: result.results,
  });

  if (result.pausedAtsTypes.length > 0) {
    console.error(
      `Discovery stopped after repeated upstream failures from ${result.pausedAtsTypes.join(", ")}.`,
    );
    console.log(JSON.stringify(summary, null, 2));
    return 1;
  }

  const { db } = await import("../db");
  const stored = upsertVerifiedCompanies(db, result.verified, new Date());
  console.log(
    JSON.stringify(
      { ...summary, inserted: stored.inserted, updated: stored.updated },
      null,
      2,
    ),
  );
  return 0;
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
  );
}
