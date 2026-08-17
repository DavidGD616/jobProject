import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { db, sqlite } from "@/db";
import { ensureActiveProfile } from "@/matching";

import { prepareApplication } from "./prepare";

function applicationId(args: readonly string[]): number {
  const index = args.findIndex((value) => value === "--application-id" || value.startsWith("--application-id="));
  const value = index >= 0 && args[index]?.startsWith("--application-id=") ? args[index]!.slice(18) : args[index + 1];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--application-id requires a positive integer");
  return parsed;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const result = await prepareApplication({ applicationId: applicationId(args), profile: ensureActiveProfile(db), database: db });
  console.log(JSON.stringify({ runId: result.run.id, adapter: result.plan.adapter, url: result.plan.url, submissionBlocked: result.plan.submissionBlocked, fields: result.plan.fields }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((exitCode) => { process.exitCode = exitCode; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => sqlite.close());
}
