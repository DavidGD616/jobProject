import type { SourceAdapter, SourceRegistration } from "@/sources";

import { ashbySourceConfig } from "./config";
import { fetch } from "./fetch";
import type { AshbyFetchConfig } from "./fetch";
import { normalize, sourceId } from "./normalize";
import type { AshbyJob } from "./schema";

export { AshbyFetchError, createAshbyFetcher, fetch } from "./fetch";
export type { AshbyFetchConfig, AshbyFetchDependencies } from "./fetch";
export { ashbySourceConfig } from "./config";
export { normalize, sourceId } from "./normalize";
export { ashbyJobSchema, ashbyResponseSchema } from "./schema";
export type { AshbyJob, AshbyResponse } from "./schema";

/** Compile-time proof that this adapter implements the shared source boundary. */
export const adapter = {
  fetch,
  normalize,
  sourceId,
} satisfies SourceAdapter<AshbyJob, AshbyFetchConfig>;

/** Registered Tier 1 policy used by the scheduled source worker. */
export const ashbySource = {
  ...ashbySourceConfig,
  adapter,
} satisfies SourceRegistration<AshbyJob, AshbyFetchConfig>;
