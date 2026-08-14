import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env.DATABASE_URL ?? "./data/jobs.sqlite";

// drizzle-kit opens the database directly and does not create parent
// directories. Keep the local data directory ignored while making first-run
// migrations work from a clean checkout.
if (databaseUrl !== ":memory:") {
  mkdirSync(dirname(resolve(databaseUrl)), { recursive: true });
}

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
});
