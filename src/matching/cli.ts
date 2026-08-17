import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { db, sqlite } from "@/db";

import { ensureActiveProfile } from "./profile";
import { rerankMatches } from "./rerank";
import { retrieveMatches } from "./retrieve";

interface Options {
  limit: number;
  rerank: boolean;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer`);
  return parsed;
}

export function parseArgs(args: readonly string[]): Options {
  const options: Options = { limit: 60, rerank: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--rerank") options.rerank = true;
    else if (argument === "--limit") options.limit = positiveInteger(args[++index] ?? "", "--limit");
    else if (argument?.startsWith("--limit=")) options.limit = positiveInteger(argument.slice(8), "--limit");
    else if (argument === "--help" || argument === "-h") return options;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return options;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  const profile = ensureActiveProfile(db);
  const ranked = retrieveMatches(profile, { limit: options.limit, database: db });
  const rerank = options.rerank
    ? await rerankMatches({ profile, matches: ranked, database: db })
    : { scored: 0, failed: 0 };
  console.log(JSON.stringify({ profileVersion: profile.version, retrieved: ranked.length, ...rerank }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then(
    (exitCode) => { process.exitCode = exitCode; },
    (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; },
  ).finally(() => sqlite.close());
}
