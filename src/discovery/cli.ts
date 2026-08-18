import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";

import {
  createNegativeProbeCache,
  createDiscoveryVerifier,
  discoverAutomaticCandidates,
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

Read the latest 36 Hacker News "Who is hiring?" threads and, when Adzuna
credentials are configured, search from the active profile's role and location.
Every resulting candidate is verified against its official ATS board before it
is upserted into SQLite.

Options:
  --hn-story-id <id>  Use a specific HN hiring-thread ID (for reproducible runs)
  --max-candidates <n>
                       Bound this run without changing its automatic source
  --cache <path>      Negative probe cache (default: ${DEFAULT_CACHE_PATH})
  --report <path>     Detailed probe diagnostics (default: ${DEFAULT_REPORT_PATH})
  --refresh-cache     Ignore cached 404s for this run
                     Optional Adzuna: set ADZUNA_APP_ID and ADZUNA_API_KEY.
                     ADZUNA_COUNTRY defaults to us.
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

  const { db } = await import("../db");
  const { getActiveProfile } = await import("../matching");
  const discovered = await discoverAutomaticCandidates({
    hnStoryId: options.hnStoryId,
    profile: getActiveProfile(db),
  });
  if (discovered.sources.adzuna.status === "skipped_missing_credentials") {
    console.error(
      "Adzuna discovery skipped: set both ADZUNA_APP_ID and ADZUNA_API_KEY to enable it.",
    );
  } else if (discovered.sources.adzuna.status === "skipped_missing_profile_query") {
    console.error(
      "Adzuna discovery skipped: save a target role in the profile to enable its automatic query.",
    );
  } else if (discovered.sources.adzuna.status === "failed") {
    console.error(
      "Adzuna discovery failed; continuing with the independent HN source.",
    );
  }
  const discoveredCandidates = discovered.candidates;
  const candidates = options.maxCandidates
    ? discoveredCandidates.slice(0, options.maxCandidates)
    : discoveredCandidates;
  if (candidates.length === 0) {
    console.error(
      "No automatic discovery candidates were found. Update the profile to enable its role-based aggregator query, or retry when a current HN hiring thread is available.",
    );
    console.log(JSON.stringify({ discovered: 0, sources: discovered.sources }, null, 2));
    return 1;
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
    sources: discovered.sources,
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
