import type { PollableSource } from "@/ingest/poller";

import type {
  SourceFetchConfig,
  SourceFetchResult,
  SourceRegistration,
} from "./_contract";
import { ashbySource } from "./ashby";
import { greenhouseSource } from "./greenhouse";
import { leverSource } from "./lever";

/**
 * The worker reads source cadence, identity, and request policy here instead
 * of baking a company list or rate limits into adapter implementations.
 */
export const sourceRegistry = {
  ashby: ashbySource,
  greenhouse: greenhouseSource,
  lever: leverSource,
} as const;

/**
 * The worker does not need a source's private raw payload type. Erase it in
 * one audited place while keeping each adapter's public contract strongly
 * typed for its source-specific tests.
 */
function asPollableSource<TRaw, TConfig extends SourceFetchConfig>(
  source: SourceRegistration<TRaw, TConfig>,
): PollableSource {
  return {
    id: source.id,
    cadenceMs: source.cadenceMs,
    userAgent: source.userAgent,
    adapter: {
      fetch(config) {
        return source.adapter.fetch(config as TConfig) as Promise<
          SourceFetchResult<unknown>
        >;
      },
      normalize(raw) {
        return source.adapter.normalize(raw as TRaw);
      },
      sourceId(raw) {
        return source.adapter.sourceId(raw as TRaw);
      },
    },
  };
}

/** All currently implemented source adapters available to the poll worker. */
export const pollableSources = [
  asPollableSource(ashbySource),
  asPollableSource(greenhouseSource),
  asPollableSource(leverSource),
] as const;
