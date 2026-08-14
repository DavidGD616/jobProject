import type { Company, NewJob } from "@/db/schema";

/**
 * The part of a company row that a source needs to make a request. Keeping
 * this smaller than the full DB row makes adapters independent of unrelated
 * company state such as block flags and probe timestamps.
 */
export type SourceCompany = Pick<
  Company,
  "id" | "name" | "atsType" | "atsToken" | "careersUrl"
>;

/** Common request controls shared by every source adapter. */
export interface SourceFetchConfig {
  company: SourceCompany;
  userAgent: string;
  signal?: AbortSignal;
  timeoutMs: number;
  /**
   * The validator returned by the previous successful fetch for this
   * company/source pair. The poller owns persisting it; adapters stay
   * database-independent.
   */
  etag?: string | null;
}

/**
 * Fetch results deliberately distinguish an unchanged board from a fetched
 * empty board. Treating an HTTP 304 as `[]` would make a poller close every
 * existing job for that company during its staleness sweep.
 */
export type SourceFetchResult<TRawPosting> =
  | {
      kind: "fetched";
      postings: TRawPosting[];
      etag: string | null;
    }
  | {
      kind: "not_modified";
      etag: string | null;
    };

/**
 * The source-owned portion of a canonical posting produced by normalize().
 * Ingest adds the registered adapter name, stable source ID, company ID,
 * observation timestamps, content hash, and deduplication links before
 * inserting a row into jobs. Enrichment owns the indexed description and
 * extraction tier; the staleness sweep owns closedAt.
 */
export type NormalizedPosting = Omit<
  NewJob,
  | "id"
  | "companyId"
  | "source"
  | "sourceId"
  | "descriptionFts"
  | "extractionTier"
  | "firstSeenAt"
  | "lastSeenAt"
  | "closedAt"
  | "contentHash"
  | "canonicalId"
>;

/**
 * Every job source implements this same boundary. The raw type is specific to
 * an upstream API; the normalized type is shared by ingest and the database.
 */
export interface SourceAdapter<
  TRawPosting,
  TConfig extends SourceFetchConfig = SourceFetchConfig,
> {
  /** Network boundary: fetch raw postings with source-specific I/O policy. */
  fetch(config: TConfig): Promise<SourceFetchResult<TRawPosting>>;

  /** Pure mapping boundary: raw source object to the canonical posting shape. */
  normalize(raw: Readonly<TRawPosting>): NormalizedPosting;

  /** Stable identifier supplied by the upstream source, never a description hash. */
  sourceId(raw: Readonly<TRawPosting>): string;
}

/**
 * The operational policy registered for an ATS source. The scheduled worker
 * uses this instead of scattering source cadence or request limits in code.
 */
export interface SourceRegistration<
  TRawPosting,
  TConfig extends SourceFetchConfig = SourceFetchConfig,
> {
  id: string;
  cadenceMs: number;
  maxConcurrentRequests: 1 | 2;
  minRequestIntervalMs: number;
  userAgent: string;
  adapter: SourceAdapter<TRawPosting, TConfig>;
}
