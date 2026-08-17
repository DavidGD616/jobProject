import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "./schema";

/** The database boundary shared by workers, repositories, and isolated tests. */
export type JobHuntDatabase = BetterSQLite3Database<typeof schema>;
