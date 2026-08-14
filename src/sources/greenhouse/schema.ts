import { z } from "zod";

const greenhouseLocationSchema = z
  .object({
    name: z.string(),
  })
  .nullable()
  .optional();

const greenhouseDepartmentSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .passthrough();

const greenhouseOfficeSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    location: z.string().nullable().optional(),
  })
  .passthrough();

export const greenhouseJobSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string(),
    updated_at: z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "expected an ISO-compatible updated_at timestamp",
    }),
    first_published: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: "expected an ISO-compatible first_published timestamp",
      })
      .nullable()
      .optional(),
    absolute_url: z.string().url(),
    location: greenhouseLocationSchema,
    content: z.string().nullable().optional(),
    departments: z.array(greenhouseDepartmentSchema).optional(),
    offices: z.array(greenhouseOfficeSchema).optional(),
  })
  .passthrough();

export const greenhouseResponseSchema = z
  .object({
    jobs: z.array(greenhouseJobSchema),
    meta: z
      .object({
        total: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type GreenhouseJob = z.infer<typeof greenhouseJobSchema>;
export type GreenhouseResponse = z.infer<typeof greenhouseResponseSchema>;
