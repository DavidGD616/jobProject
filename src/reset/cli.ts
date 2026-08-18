import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { clearFreshStartState, db, sqlite } from "@/db";
import type { JobHuntDatabase } from "@/db";
import { removeGeneratedResumeExports } from "@/tailor/exports";

export interface FreshStartCliOptions {
  freshStart: boolean;
  help: boolean;
}

export interface RunFreshStartOptions {
  database?: JobHuntDatabase;
  exportDirectory?: string;
  unlinkFile?: (path: string) => Promise<void>;
}

export interface FreshStartCliResult {
  applicationsCleared: number;
  applicationRunsCleared: number;
  eventsCleared: number;
  interestedTriageCleared: number;
  rankingFeedbackCleared: number;
  learnedScoresReset: number;
  tailorRequestsCleared: number;
  resumeVariantsCleared: number;
  filesRemoved: string[];
}

function usage(): string {
  return `Usage: pnpm reset -- --fresh-start\n\nClear saved applications, interested jobs, generated materials, and their local HTML/PDF exports.\nYour profile, job/company catalog, current match rows, and skip/block preferences are preserved.\n\nOptions:\n  --fresh-start  Clear the saved application workspace\n  --help, -h     Show this help\n`;
}

/** Require an explicit destructive mode; `pnpm reset` alone changes nothing. */
export function parseArgs(args: readonly string[]): FreshStartCliOptions {
  let freshStart = false;
  let help = false;

  for (const argument of args) {
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--fresh-start") {
      freshStart = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (!help && !freshStart) {
    throw new Error("Provide --fresh-start to clear saved application data");
  }
  return { freshStart, help };
}

/** Clear database state first, then remove only export files owned by those variants. */
export async function runFreshStart(
  options: RunFreshStartOptions = {},
): Promise<FreshStartCliResult> {
  const cleared = clearFreshStartState(options.database ?? db);
  const { filesRemoved } = await removeGeneratedResumeExports({
    variants: cleared.resumeVariants,
    exportDirectory: options.exportDirectory,
    unlinkFile: options.unlinkFile,
  });
  return {
    applicationsCleared: cleared.applicationsCleared,
    applicationRunsCleared: cleared.applicationRunsCleared,
    eventsCleared: cleared.eventsCleared,
    interestedTriageCleared: cleared.interestedTriageCleared,
    rankingFeedbackCleared: cleared.rankingFeedbackCleared,
    learnedScoresReset: cleared.learnedScoresReset,
    tailorRequestsCleared: cleared.tailorRequestsCleared,
    resumeVariantsCleared: cleared.resumeVariants.length,
    filesRemoved,
  };
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  console.log(JSON.stringify(await runFreshStart(), null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then(
    (exitCode) => { process.exitCode = exitCode; },
    (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; },
  ).finally(() => sqlite.close());
}
