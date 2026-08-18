import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { db, sqlite } from "@/db";
import { ensureActiveProfile } from "@/matching";

import { runLearning } from "./model";

export function main(): number {
  const profile = ensureActiveProfile(db);
  const result = runLearning(profile.id, db);
  console.log(JSON.stringify({ profileVersion: profile.version, ...result, trained: result.model !== null }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; } finally { sqlite.close(); }
}
