import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const configuredPath = process.env.DATABASE_URL ?? "data/jobs.sqlite";
const databasePath =
  configuredPath === ":memory:" ? configuredPath : resolve(configuredPath);

function createConnection() {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);

  // WAL lets the UI read while the scheduled worker writes. Foreign keys are
  // disabled by default in SQLite, so enable them for every connection.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  return {
    sqlite,
    db: drizzle(sqlite, { schema }),
  };
}

// Next.js reloads server modules during development. Reuse one connection so
// each reload does not create another SQLite handle or hold another lock.
const globalForDatabase = globalThis as typeof globalThis & {
  __jobHuntDatabase?: ReturnType<typeof createConnection>;
};

const connection =
  globalForDatabase.__jobHuntDatabase ?? createConnection();

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.__jobHuntDatabase = connection;
}

export const sqlite = connection.sqlite;
export const db = connection.db;
