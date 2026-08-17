import { createHash } from "node:crypto";

/**
 * Layer-two deduplication key. Delimit fields so distinct input tuples cannot
 * collide through concatenation before their SHA-256 digest is calculated.
 */
export function contentHash(input: {
  titleNorm: string;
  companySlug: string;
  description: string;
}): string {
  return createHash("sha256")
    .update(input.titleNorm)
    .update("\u0000")
    .update(input.companySlug)
    .update("\u0000")
    .update(input.description)
    .digest("hex");
}
