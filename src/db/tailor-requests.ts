import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "./client";
import { tailorRequests } from "./schema";
import type { TailorRequest } from "./schema";
import type { JobHuntDatabase } from "./types";

export const tailorRequestStatuses = ["queued", "running", "completed", "failed"] as const;
export type TailorRequestStatus = (typeof tailorRequestStatuses)[number];

const activeRequestStatuses: TailorRequestStatus[] = ["queued", "running"];

/** Queue one local-worker tailoring run, coalescing repeated clicks while it is active. */
export function enqueueTailorRequest(input: {
  jobId: number;
  database?: JobHuntDatabase;
  now?: Date;
}): TailorRequest {
  const database = input.database ?? db;
  const existing = database
    .select()
    .from(tailorRequests)
    .where(and(
      eq(tailorRequests.jobId, input.jobId),
      inArray(tailorRequests.status, activeRequestStatuses),
    ))
    .orderBy(desc(tailorRequests.createdAt))
    .get();
  if (existing) return existing;

  return database.insert(tailorRequests).values({
    jobId: input.jobId,
    status: "queued",
    createdAt: input.now ?? new Date(),
  }).returning().get()!;
}

/**
 * Claim the oldest queued request. The project has one local writer, and the
 * status predicate protects against an accidental second worker.
 */
export function claimNextTailorRequest(
  database: JobHuntDatabase = db,
  now = new Date(),
): TailorRequest | null {
  const queued = database
    .select()
    .from(tailorRequests)
    .where(eq(tailorRequests.status, "queued"))
    .orderBy(asc(tailorRequests.createdAt), asc(tailorRequests.id))
    .get();
  if (!queued) return null;

  return database
    .update(tailorRequests)
    .set({ status: "running", startedAt: now, finishedAt: null, error: null })
    .where(and(eq(tailorRequests.id, queued.id), eq(tailorRequests.status, "queued")))
    .returning()
    .get() ?? null;
}

export function completeTailorRequest(input: {
  requestId: number;
  variantId: number;
  database?: JobHuntDatabase;
  now?: Date;
}): TailorRequest {
  const database = input.database ?? db;
  const request = database
    .update(tailorRequests)
    .set({
      status: "completed",
      variantId: input.variantId,
      error: null,
      finishedAt: input.now ?? new Date(),
    })
    .where(and(eq(tailorRequests.id, input.requestId), eq(tailorRequests.status, "running")))
    .returning()
    .get();
  if (!request) throw new Error(`Tailor request ${input.requestId} is not running`);
  return request;
}

export function failTailorRequest(input: {
  requestId: number;
  error: string;
  database?: JobHuntDatabase;
  now?: Date;
}): TailorRequest {
  const database = input.database ?? db;
  const request = database
    .update(tailorRequests)
    .set({
      status: "failed",
      error: input.error.slice(0, 2_000),
      finishedAt: input.now ?? new Date(),
    })
    .where(and(eq(tailorRequests.id, input.requestId), eq(tailorRequests.status, "running")))
    .returning()
    .get();
  if (!request) throw new Error(`Tailor request ${input.requestId} is not running`);
  return request;
}

export function listTailorRequests(
  jobId: number,
  database: JobHuntDatabase = db,
): TailorRequest[] {
  return database
    .select()
    .from(tailorRequests)
    .where(eq(tailorRequests.jobId, jobId))
    .orderBy(desc(tailorRequests.createdAt), desc(tailorRequests.id))
    .all();
}
