import { z } from "zod";

const ashbySecondaryLocationSchema = z.union([
  z.string(),
  z
    .object({
      location: z.string().nullable().optional(),
    })
    .passthrough(),
]);

const ashbyCompensationComponentSchema = z
  .object({
    compensationType: z.string().nullable().optional(),
    interval: z.string().nullable().optional(),
    currencyCode: z.string().nullable().optional(),
    minValue: z.number().nullable().optional(),
    maxValue: z.number().nullable().optional(),
  })
  .passthrough();

const ashbyCompensationTierSchema = z
  .object({
    components: z.array(ashbyCompensationComponentSchema).optional(),
  })
  .passthrough();

const ashbyCompensationSchema = z
  .object({
    summaryComponents: z.array(ashbyCompensationComponentSchema).optional(),
    compensationTiers: z.array(ashbyCompensationTierSchema).optional(),
  })
  .passthrough();

function isValidDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** Public response from Ashby's unauthenticated Job Board endpoint. */
export const ashbyJobSchema = z
  .object({
    id: z.string().trim().min(1),
    title: z.string(),
    jobUrl: z.string().url(),
    applyUrl: z.string().url().nullable().optional(),
    descriptionHtml: z.string().nullable().optional(),
    descriptionPlain: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    secondaryLocations: z.array(ashbySecondaryLocationSchema).nullable().optional(),
    workplaceType: z.string().nullable().optional(),
    isRemote: z.boolean().nullable().optional(),
    isListed: z.boolean().nullable().optional(),
    publishedAt: z
      .string()
      .refine(isValidDate, {
        message: "expected an ISO-compatible publishedAt timestamp",
      })
      .nullable()
      .optional(),
    compensation: ashbyCompensationSchema.nullable().optional(),
  })
  .passthrough()
  .refine(
    (job) => Boolean(job.descriptionHtml?.trim() || job.descriptionPlain?.trim()),
    { message: "expected a non-empty descriptionHtml or descriptionPlain" },
  );

export const ashbyResponseSchema = z
  .object({
    jobs: z.array(ashbyJobSchema),
  })
  .passthrough();

export type AshbyJob = z.infer<typeof ashbyJobSchema>;
export type AshbyResponse = z.infer<typeof ashbyResponseSchema>;
