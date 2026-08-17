import { ingestSourceSnapshot } from "@/db/jobs";
import type { ObservedPosting } from "@/db/jobs";
import {
  deactivateCompanyBoard,
  listDueSourcePolls,
  recordSourcePollFailure,
  recordSourcePollSuccess,
} from "@/db/source-polls";
import type { JobHuntDatabase } from "@/db/types";
import type {
  NormalizedPosting,
  SourceFetchConfig,
  SourceFetchResult,
} from "@/sources";

const DEFAULT_TIMEOUT_MS = 20_000;
const FIRST_FAILURE_DELAY_MS = 60_000;
const MAX_FAILURE_DELAY_MS = 60 * 60 * 1_000;
const MAX_CONSECUTIVE_SOURCE_FAILURES = 2;

/**
 * Type-erased view of a registered source. It keeps the worker generic while
 * each source's raw API type remains private to its adapter directory.
 */
export interface PollableSource {
  id: string;
  cadenceMs: number;
  userAgent: string;
  adapter: {
    fetch(config: SourceFetchConfig): Promise<SourceFetchResult<unknown>>;
    normalize(raw: unknown): NormalizedPosting;
    sourceId(raw: unknown): string;
  };
}

export interface SourcePollRunSummary {
  sources: number;
  due: number;
  attempted: number;
  fetched: number;
  notModified: number;
  failed: number;
  deactivated: number;
  pausedSources: string[];
  inserted: number;
  updated: number;
  canonicalized: number;
  firstMissing: number;
  closed: number;
}

export interface RunSourcePollsOptions {
  sources: readonly PollableSource[];
  sourceIds?: readonly string[];
  force?: boolean;
  timeoutMs?: number;
  now?: () => Date;
}

function emptySummary(): SourcePollRunSummary {
  return {
    sources: 0,
    due: 0,
    attempted: 0,
    fetched: 0,
    notModified: 0,
    failed: 0,
    deactivated: 0,
    pausedSources: [],
    inserted: 0,
    updated: 0,
    canonicalized: 0,
    firstMissing: 0,
    closed: 0,
  };
}

function mergeIngestSummary(
  summary: SourcePollRunSummary,
  ingest: Pick<
    SourcePollRunSummary,
    "inserted" | "updated" | "canonicalized" | "firstMissing" | "closed"
  >,
): void {
  summary.inserted += ingest.inserted;
  summary.updated += ingest.updated;
  summary.canonicalized += ingest.canonicalized;
  summary.firstMissing += ingest.firstMissing;
  summary.closed += ingest.closed;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sourceErrorStatus(cause: unknown): number | undefined {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "status" in cause &&
    typeof cause.status === "number"
  ) {
    return cause.status;
  }
  return undefined;
}

function isAccessDenied(status: number | undefined): boolean {
  return status === 401 || status === 403 || status === 451;
}

function isMissingBoard(status: number | undefined): boolean {
  return status === 404 || status === 410;
}

function isRetryableSourceFailure(status: number | undefined): boolean {
  // An error without an HTTP status is normally a network, timeout, or invalid
  // upstream response. Treat repeated occurrences as a source-level signal too.
  return status === undefined || status === 429 || status >= 500;
}

function sourceErrorRetryDelay(cause: unknown): number | undefined {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "retryDelayMs" in cause &&
    typeof cause.retryDelayMs === "number" &&
    Number.isFinite(cause.retryDelayMs) &&
    cause.retryDelayMs >= 0
  ) {
    return cause.retryDelayMs;
  }
  return undefined;
}

function nextFailureAt(
  now: Date,
  consecutiveFailures: number,
  cadenceMs: number,
): Date {
  const retryMs = Math.min(
    FIRST_FAILURE_DELAY_MS * 2 ** Math.max(0, consecutiveFailures - 1),
    MAX_FAILURE_DELAY_MS,
    cadenceMs,
  );
  return new Date(now.valueOf() + retryMs);
}

function nextSuccessfulSnapshotAt(
  now: Date,
  previousSuccessfulAt: Date | null | undefined,
): Date {
  return new Date(
    Math.max(now.valueOf(), (previousSuccessfulAt?.valueOf() ?? -Infinity) + 1),
  );
}

function observedPostings(
  source: PollableSource,
  rawPostings: readonly unknown[],
): ObservedPosting[] {
  const seenSourceIds = new Set<string>();
  const postings: ObservedPosting[] = [];

  for (const raw of rawPostings) {
    const sourceId = source.adapter.sourceId(raw).trim();
    if (!sourceId) {
      throw new Error(`${source.id} returned a posting without a stable source ID`);
    }
    if (seenSourceIds.has(sourceId)) {
      throw new Error(`${source.id} returned duplicate source ID ${sourceId}`);
    }
    seenSourceIds.add(sourceId);
    postings.push({ sourceId, posting: source.adapter.normalize(raw) });
  }

  return postings;
}

/**
 * Poll each due board. A source is sequential by design: its adapter may use
 * internal concurrency, but an access-denied response stops later boards from
 * being dispatched during this run.
 */
export async function runSourcePolls(
  db: JobHuntDatabase,
  options: RunSourcePollsOptions,
): Promise<SourcePollRunSummary> {
  const summary = emptySummary();
  const allowedSources = options.sourceIds
    ? new Set(options.sourceIds)
    : undefined;
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const source of options.sources) {
    if (allowedSources && !allowedSources.has(source.id)) continue;
    summary.sources += 1;
    const due = listDueSourcePolls(db, {
      source: source.id,
      now: now(),
      force: options.force,
    });
    summary.due += due.length;
    let paused = false;
    let consecutiveSourceFailures = 0;

    for (const { company, poll } of due) {
      if (paused) break;
      summary.attempted += 1;

      try {
        const result = await source.adapter.fetch({
          company,
          userAgent: source.userAgent,
          timeoutMs,
          etag: poll?.etag ?? null,
        });
        const completedAt = now();

        if (result.kind === "not_modified") {
          recordSourcePollSuccess(db, {
            companyId: company.id,
            source: source.id,
            etag: result.etag,
            status: "not_modified",
            fetchedAt: completedAt,
            nextPollAt: new Date(completedAt.valueOf() + source.cadenceMs),
          });
          consecutiveSourceFailures = 0;
          summary.notModified += 1;
          continue;
        }

        const postings = observedPostings(source, result.postings);
        const snapshotAt = nextSuccessfulSnapshotAt(
          completedAt,
          poll?.lastSuccessfulAt,
        );
        const ingest = await ingestSourceSnapshot(db, {
          company,
          source: source.id,
          postings,
          observedAt: snapshotAt,
        });
        recordSourcePollSuccess(db, {
          companyId: company.id,
          source: source.id,
          etag: result.etag,
          status: "fetched",
          fetchedAt: snapshotAt,
          nextPollAt: new Date(snapshotAt.valueOf() + source.cadenceMs),
        });
        consecutiveSourceFailures = 0;
        mergeIngestSummary(summary, ingest);
        summary.fetched += 1;
      } catch (cause) {
        const completedAt = now();
        const status = sourceErrorStatus(cause);
        const retryDelayMs = sourceErrorRetryDelay(cause);
        const failures = (poll?.consecutiveFailures ?? 0) + 1;
        const statusLabel = status ? `http_${status}` : "error";
        const missingBoard = isMissingBoard(status);
        const accessDenied = isAccessDenied(status);

        const boundedFailureAt = nextFailureAt(
          completedAt,
          failures,
          source.cadenceMs,
        );
        recordSourcePollFailure(db, {
          companyId: company.id,
          source: source.id,
          status: statusLabel,
          error: errorMessage(cause),
          consecutiveFailures: failures,
          fetchedAt: completedAt,
          nextPollAt: missingBoard
            ? null
            : new Date(
              Math.max(
                boundedFailureAt.valueOf(),
                completedAt.valueOf() + (retryDelayMs ?? 0),
              ),
            ),
        });
        if (missingBoard) {
          deactivateCompanyBoard(db, {
            companyId: company.id,
            checkedAt: completedAt,
          });
          summary.deactivated += 1;
        }
        if (isRetryableSourceFailure(status)) {
          consecutiveSourceFailures += 1;
        } else {
          consecutiveSourceFailures = 0;
        }
        // A final 429 already represents repeated rate limiting for this
        // board, and two retryable failures across boards indicate a source
        // problem. Stop dispatching for this source and leave its persisted
        // nextPollAt values to control the next worker scan.
        if (
          accessDenied ||
          status === 429 ||
          consecutiveSourceFailures >= MAX_CONSECUTIVE_SOURCE_FAILURES
        ) {
          paused = true;
          summary.pausedSources.push(source.id);
        }
        summary.failed += 1;
      }
    }
  }

  return summary;
}
