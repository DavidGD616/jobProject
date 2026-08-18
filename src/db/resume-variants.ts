import { asc, eq, inArray } from "drizzle-orm";

import { db } from "./client";
import { applications, resumeVariants, tailorRequests } from "./schema";
import type { ResumeVariant } from "./schema";
import type { JobHuntDatabase } from "./types";

export interface ClearedResumeVariant {
  id: number;
  pdfPath: string | null;
}

/** Save the human-reviewed letter and keep its attached application in sync. */
export function updateResumeVariantCoverLetter(input: {
  variantId: number;
  coverLetter: string;
  database?: JobHuntDatabase;
  now?: Date;
}): ResumeVariant {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const coverLetter = input.coverLetter.trim() || null;
  return database.transaction((tx) => {
    const variant = tx
      .update(resumeVariants)
      .set({ coverLetter })
      .where(eq(resumeVariants.id, input.variantId))
      .returning()
      .get();
    if (!variant) throw new Error(`Resume variant ${input.variantId} not found`);

    // Keep the live attachment consistent. Existing prepared runs retain their
    // prior hash and will consequently be recognized as stale.
    tx
      .update(applications)
      .set({ coverLetter, updatedAt: now })
      .where(eq(applications.resumeVariantId, input.variantId))
      .run();
    return variant;
  });
}

/**
 * Remove every generated resume variant while retaining the user's profile,
 * jobs, applications, and tailoring-request history. References are detached
 * before the variants are deleted so SQLite foreign keys remain valid.
 */
export function clearAllResumeVariants(
  database: JobHuntDatabase = db,
  now = new Date(),
): ClearedResumeVariant[] {
  return database.transaction((tx) => {
    const variants = tx
      .select({ id: resumeVariants.id, pdfPath: resumeVariants.pdfPath })
      .from(resumeVariants)
      .orderBy(asc(resumeVariants.id))
      .all();
    if (variants.length === 0) return [];

    const variantIds = variants.map((variant) => variant.id);
    tx
      .update(applications)
      .set({ resumeVariantId: null, updatedAt: now })
      .where(inArray(applications.resumeVariantId, variantIds))
      .run();
    tx
      .update(tailorRequests)
      .set({ variantId: null })
      .where(inArray(tailorRequests.variantId, variantIds))
      .run();
    tx.delete(resumeVariants).run();

    return variants;
  });
}
