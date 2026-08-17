import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { db, sqlite } from "@/db";
import { jobs } from "@/db/schema";

import { benchmarkProviders } from "./bench";
import { claudeProvider } from "./providers/claude";
import { codexProvider } from "./providers/codex";

function limit(args: readonly string[]): number {
  const index = args.findIndex((value) => value === "--limit" || value.startsWith("--limit="));
  const value = index >= 0 && args[index]?.startsWith("--limit=") ? args[index]!.slice(8) : args[index + 1];
  const parsed = value === undefined ? 20 : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) throw new Error("--limit must be an integer from 1 to 20");
  return parsed;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const samples = db.select({ id: jobs.id, description: jobs.description }).from(jobs).limit(limit(args)).all();
  const report = await benchmarkProviders({ providers: [claudeProvider, codexProvider], samples: samples.map((sample) => ({ id: String(sample.id), description: sample.description })) });
  console.log(JSON.stringify({ samples: samples.length, report }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((exitCode) => { process.exitCode = exitCode; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => sqlite.close());
}
