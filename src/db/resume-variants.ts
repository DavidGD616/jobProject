import { eq } from "drizzle-orm";

import { db } from "./client";
import { applications, resumeVariants } from "./schema";
import type { ResumeVariant } from "./schema";
import type { JobHuntDatabase } from "./types";

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
