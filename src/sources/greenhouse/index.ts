import type { SourceAdapter } from "@/sources";

import { fetch } from "./fetch";
import type { GreenhouseFetchConfig } from "./fetch";
import { normalize, sourceId } from "./normalize";
import type { GreenhouseJob } from "./schema";

export { fetch, GreenhouseFetchError } from "./fetch";
export type { GreenhouseFetchConfig } from "./fetch";
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
