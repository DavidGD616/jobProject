import { z } from "zod";

const leverCategoriesSchema = z
  .object({
    commitment: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    team: z.string().nullable().optional(),
    allLocations: z.array(z.string()).nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const leverSalaryRangeSchema = z
  .object({
    min: z.number().finite().nonnegative().nullable().optional(),
    max: z.number().finite().nonnegative().nullable().optional(),
    currency: z.string().nullable().optional(),
    interval: z.string().nullable().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const leverListSchema = z
  .object({
    text: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
  })
  .passthrough();

/** The published JSON shape returned by GET /v0/postings/{company}?mode=json. */
export const leverJobSchema = z
  .object({
    id: z.string().min(1),
    text: z.string(),
    hostedUrl: z.string().url(),
    createdAt: z.number().int().nonnegative().nullable().optional(),
    categories: leverCategoriesSchema,
    workplaceType: z.string().nullable().optional(),
    salaryRange: leverSalaryRangeSchema,
    description: z.string().nullable().optional(),
    descriptionBody: z.string().nullable().optional(),
    descriptionPlain: z.string().nullable().optional(),
    opening: z.string().nullable().optional(),
    additional: z.string().nullable().optional(),
    lists: z.array(leverListSchema).nullable().optional(),
  })
  .passthrough();

export const leverResponseSchema = z.array(leverJobSchema);

export type LeverJob = z.infer<typeof leverJobSchema>;
export type LeverResponse = z.infer<typeof leverResponseSchema>;
