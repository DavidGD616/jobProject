import { resolve } from "node:path";

import "dotenv/config";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db, sqlite } from "./client";

try {
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
} finally {
  sqlite.close();
}
