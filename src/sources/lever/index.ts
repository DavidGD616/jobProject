import type { SourceAdapter, SourceRegistration } from "@/sources";

import { leverSourceConfig } from "./config";
import { fetch } from "./fetch";
import type { LeverFetchConfig } from "./fetch";
import { normalize, sourceId } from "./normalize";
import type { LeverJob } from "./schema";

export { leverSourceConfig } from "./config";
export { createLeverFetcher, fetch, LeverFetchError } from "./fetch";
export type { LeverFetchConfig, LeverFetchDependencies } from "./fetch";
export { normalize, sourceId } from "./normalize";
export { leverJobSchema, leverResponseSchema } from "./schema";
export type { LeverJob, LeverResponse } from "./schema";

/** Compile-time proof that this adapter implements the shared source boundary. */
export const adapter = {
  fetch,
  normalize,
  sourceId,
} satisfies SourceAdapter<LeverJob, LeverFetchConfig>;

/** Registered Tier 1 policy used by the scheduled source worker. */
export const leverSource = {
  ...leverSourceConfig,
  adapter,
} satisfies SourceRegistration<LeverJob, LeverFetchConfig>;
