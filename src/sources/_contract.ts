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
}

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
  fetch(config: TConfig): Promise<TRawPosting[]>;

  /** Pure mapping boundary: raw source object to the canonical posting shape. */
  normalize(raw: Readonly<TRawPosting>): NormalizedPosting;

  /** Stable identifier supplied by the upstream source, never a description hash. */
  sourceId(raw: Readonly<TRawPosting>): string;
}
