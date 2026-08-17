import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { db, sqlite } from "@/db";
import { ensureActiveProfile } from "@/matching";

import { createTailoredVariant } from "./engine";

function jobId(args: readonly string[]): number {
  const index = args.findIndex((value) => value === "--job-id" || value.startsWith("--job-id="));
  const value = index >= 0 && args[index]?.startsWith("--job-id=") ? args[index]!.slice(9) : args[index + 1];
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--job-id requires a positive integer");
  return parsed;
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const id = jobId(args);
  const variant = await createTailoredVariant({ jobId: id, profile: ensureActiveProfile(db), database: db, allowLlm: true });
  console.log(JSON.stringify({ variantId: variant.variant.id, htmlPath: variant.htmlPath, pdfPath: variant.pdfPath, llmUsed: variant.llmUsed }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((exitCode) => { process.exitCode = exitCode; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => sqlite.close());
}
