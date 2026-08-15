import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  createNegativeProbeCache,
  createDiscoveryVerifier,
  discoveryProbeConfig,
  loadNegativeProbeCache,
  parseCandidateNames,
  runBulkProbe,
  saveNegativeProbeCache,
  upsertVerifiedCompanies,
} from "./index";

const DEFAULT_CACHE_PATH = "data/discovery-negative-cache.json";

interface CliOptions {
  inputPath?: string;
  cachePath: string;
  refreshCache: boolean;
  help: boolean;
}

function usage(): string {
  return `Usage: pnpm discover:seed -- --input <candidate-file>

Read newline-delimited company names from --input or stdin, verify public
Greenhouse, Lever, and Ashby boards, and upsert verified companies into SQLite.

Options:
  --input, -i <path>  Candidate file; stdin is used when omitted
  --cache <path>      Negative probe cache (default: ${DEFAULT_CACHE_PATH})
  --refresh-cache     Ignore cached 404s for this run
  --help, -h          Show this help
`;
}

function parseArgs(args: readonly string[]): CliOptions {
  const options: CliOptions = {
    cachePath: DEFAULT_CACHE_PATH,
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
    } else if (argument === "--input" || argument === "-i") {
      options.inputPath = args[++index];
      if (!options.inputPath) throw new Error("--input requires a path");
    } else if (argument?.startsWith("--input=")) {
      options.inputPath = argument.slice("--input=".length);
    } else if (argument === "--cache") {
      options.cachePath = args[++index] ?? "";
      if (!options.cachePath) throw new Error("--cache requires a path");
    } else if (argument?.startsWith("--cache=")) {
      options.cachePath = argument.slice("--cache=".length);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

function readCandidates(inputPath?: string): string {
  if (inputPath) return readFileSync(resolve(inputPath), "utf8");

  const configuredPath = process.env.DISCOVERY_CANDIDATES_PATH;
  if (configuredPath) return readFileSync(resolve(configuredPath), "utf8");

  const defaultPath = resolve("data/discovery-candidates.txt");
  if (existsSync(defaultPath)) return readFileSync(defaultPath, "utf8");

  if (!process.stdin.isTTY) return readFileSync(0, "utf8");

  throw new Error(
    "No candidate source configured; pass --input or pipe newline-delimited names on stdin",
  );
}

export async function main(args: readonly string[] = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const candidates = parseCandidateNames(readCandidates(options.inputPath));
  if (candidates.length === 0) {
    throw new Error("Candidate input did not contain any company names");
  }

  const negativeCache = options.refreshCache
    ? createNegativeProbeCache()
    : loadNegativeProbeCache(options.cachePath);
  const verifier = createDiscoveryVerifier({}, { negativeCache });
  const result = await runBulkProbe(candidates, {
    verifier,
    maxCandidatesInFlight: discoveryProbeConfig.maxCandidatesInFlight,
  });

  const { db } = await import("../db");
  const stored = upsertVerifiedCompanies(db, result.verified, new Date());
  saveNegativeProbeCache(options.cachePath, negativeCache);

  const attempts = result.results.flatMap((probeResult) => probeResult.attempts);
  const count = (outcome: string) =>
    attempts.filter((attempt) => attempt.outcome === outcome).length;

  console.log(
    JSON.stringify(
      {
        candidates: result.candidates,
        verified: result.verified.length,
        inserted: stored.inserted,
        updated: stored.updated,
        attempts: attempts.length,
        notFound: count("not_found"),
        cachedMisses: count("cached_miss"),
        invalidPayloads: count("invalid_payload"),
        failures: count("failed"),
      },
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
