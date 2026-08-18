import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import {
  clearAllResumeVariants,
  claimNextTailorRequest,
  completeTailorRequest,
  db,
  failTailorRequest,
  sqlite,
} from "@/db";
import type { JobHuntDatabase } from "@/db";
import { ensureActiveProfile } from "@/matching";

import { createTailoredVariant } from "./engine";
import { removeGeneratedResumeExports } from "./exports";

export interface TailorCliOptions {
  jobId: number | null;
  next: boolean;
  clearAll: boolean;
  help: boolean;
}

function usage(): string {
  return `Usage: pnpm tailor -- (--job-id <id> | --next | --clear-all)\n\nGenerate one tailored resume locally. --next claims the oldest request queued by the UI.\n\nOptions:\n  --job-id <id>  Generate a variant for one job immediately\n  --next         Process the oldest queued tailoring request\n  --clear-all    Delete every generated resume variant and its local HTML/PDF exports\n                 (profiles, jobs, applications, and request history are preserved)\n  --help, -h     Show this help\n`;
}

export function parseArgs(args: readonly string[]): TailorCliOptions {
  let jobId: number | null = null;
  let next = false;
  let clearAll = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--next") {
      next = true;
    } else if (argument === "--clear-all") {
      clearAll = true;
    } else if (argument === "--job-id" || argument?.startsWith("--job-id=")) {
      const value = argument === "--job-id" ? args[++index] : argument.slice("--job-id=".length);
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--job-id requires a positive integer");
      jobId = parsed;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!help && Number(next) + Number(jobId !== null) + Number(clearAll) !== 1) {
    throw new Error("Provide exactly one of --job-id <id>, --next, or --clear-all");
  }
  return { jobId, next, clearAll, help };
}

export interface ClearAllTailoredVariantsOptions {
  database?: JobHuntDatabase;
  exportDirectory?: string;
  now?: Date;
  unlinkFile?: (path: string) => Promise<void>;
}

export interface ClearAllTailoredVariantsResult {
  variantsCleared: number;
  filesRemoved: string[];
}

/** Clear variant rows and the local HTML/PDF files generated for them. */
export async function clearAllTailoredVariants(
  options: ClearAllTailoredVariantsOptions = {},
): Promise<ClearAllTailoredVariantsResult> {
  const variants = clearAllResumeVariants(options.database ?? db, options.now);
  const { filesRemoved } = await removeGeneratedResumeExports({
    variants,
    exportDirectory: options.exportDirectory,
    unlinkFile: options.unlinkFile,
  });

  return { variantsCleared: variants.length, filesRemoved };
}

export async function processNextTailorRequest(
  database: JobHuntDatabase = db,
): Promise<{ status: "idle" } | { status: "completed"; requestId: number; variantId: number; htmlPath: string; pdfPath: string | null; llmUsed: boolean }> {
  const request = claimNextTailorRequest(database);
  if (!request) return { status: "idle" };
  try {
    const variant = await createTailoredVariant({
      jobId: request.jobId,
      profile: ensureActiveProfile(database),
      database,
      allowLlm: true,
    });
    completeTailorRequest({
      requestId: request.id,
      variantId: variant.variant.id,
      database,
    });
    return {
      status: "completed",
      requestId: request.id,
      variantId: variant.variant.id,
      htmlPath: variant.htmlPath,
      pdfPath: variant.pdfPath,
      llmUsed: variant.llmUsed,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    failTailorRequest({ requestId: request.id, error: message, database });
    throw cause;
  }
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (options.next) {
    console.log(JSON.stringify(await processNextTailorRequest(), null, 2));
    return 0;
  }
  if (options.clearAll) {
    console.log(JSON.stringify(await clearAllTailoredVariants(), null, 2));
    return 0;
  }
  const variant = await createTailoredVariant({ jobId: options.jobId!, profile: ensureActiveProfile(db), database: db, allowLlm: true });
  console.log(JSON.stringify({ variantId: variant.variant.id, htmlPath: variant.htmlPath, pdfPath: variant.pdfPath, llmUsed: variant.llmUsed }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then((exitCode) => { process.exitCode = exitCode; }, (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }).finally(() => sqlite.close());
}
