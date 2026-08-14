import type { SourceAdapter, SourceRegistration } from "@/sources";

import { greenhouseSourceConfig } from "./config";
import { fetch } from "./fetch";
import type { GreenhouseFetchConfig } from "./fetch";
import { normalize, sourceId } from "./normalize";
import type { GreenhouseJob } from "./schema";

export { fetch, GreenhouseFetchError } from "./fetch";
export { createGreenhouseFetcher } from "./fetch";
export type { GreenhouseFetchConfig, GreenhouseFetchDependencies } from "./fetch";
export { greenhouseSourceConfig } from "./config";
export { normalize, sourceId } from "./normalize";
export {
  greenhouseJobSchema,
  greenhouseResponseSchema,
} from "./schema";
export type { GreenhouseJob, GreenhouseResponse } from "./schema";

/** Compile-time proof that this adapter implements the shared source boundary. */
export const adapter = {
  fetch,
  normalize,
  sourceId,
} satisfies SourceAdapter<GreenhouseJob, GreenhouseFetchConfig>;

/** Registered Tier 1 policy used by the scheduled source worker. */
export const greenhouseSource = {
  ...greenhouseSourceConfig,
  adapter,
} satisfies SourceRegistration<GreenhouseJob, GreenhouseFetchConfig>;
