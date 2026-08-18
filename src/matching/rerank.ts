import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { jobs, matches } from "@/db/schema";
import type { Profile } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";
import { runStructured } from "@/llm";
import type { LlmProvider } from "@/llm";

import type { RankedMatch } from "./retrieve";
import { fewShotExamples } from "./query";

const extractedSchema = z.object({
  salary_min: z.number().int().nullable(),
  salary_max: z.number().int().nullable(),
  currency: z.string().nullable(),
  seniority: z.string().nullable(),
  remote_type: z.enum(["remote", "hybrid", "onsite", "unknown"]).nullable(),
  stack: z.array(z.string()),
}).strict();

const rerankItemSchema = z.object({
  job_id: z.number().int(),
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  gaps: z.array(z.string()),
  strengths: z.array(z.string()),
  flags: z.array(z.string()),
  extracted: extractedSchema,
}).strict();

const rerankResponseSchema = z.object({ results: z.array(rerankItemSchema) }).strict();
const rerankOutputSchema = z.toJSONSchema(rerankResponseSchema);

function schemaForBatch(batch: readonly RankedMatch[]) {
  const expectedIds = new Set(batch.map((match) => match.job.id));
  return rerankResponseSchema.superRefine((value, context) => {
    const receivedIds = value.results.map((item) => item.job_id);
    const receivedUnique = new Set(receivedIds);
    if (
      receivedIds.length !== expectedIds.size
      || receivedUnique.size !== receivedIds.length
      || [...receivedUnique].some((id) => !expectedIds.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "results must contain exactly one entry for every supplied job_id",
      });
    }
  });
}

function promptFor(profile: Profile, batch: RankedMatch[], database: JobHuntDatabase): string {
  const examples = fewShotExamples(profile.id, database);
  return [
    "You are ranking job postings against a candidate profile.",
    "Return ONLY a JSON object with a results array containing exactly one object for every supplied role. Use only the job_id values supplied below. Score 90-100 means unusually strong fit; 40 means plausible but significant gaps; below 25 means poor fit.",
    "Every object must have this exact shape. Keep reasoning concrete and concise; use empty arrays and null values when a detail is unavailable.",
    "For extracted.remote_type, use exactly remote, hybrid, onsite, or unknown; use unknown when the role permits more than one arrangement or is unclear.",
    JSON.stringify({ results: [{
      job_id: 123,
      score: 0,
      reasoning: "Concrete fit assessment based only on the profile and role.",
      gaps: ["A requirement not evidenced in the profile"],
      strengths: ["A concrete profile-to-role overlap"],
      flags: ["A material concern, if any"],
      extracted: {
        salary_min: null,
        salary_max: null,
        currency: null,
        seniority: null,
        remote_type: null,
        stack: [],
      },
    }]}),
    `Candidate profile: ${JSON.stringify(profile)}`,
    examples.length > 0 ? `Recent human labels (use as weak examples, not rules): ${JSON.stringify(examples)}` : "No human labels yet.",
    "Roles:",
    ...batch.map((match) => JSON.stringify({
      job_id: match.job.id,
      title: match.job.title,
      company: match.company.name,
      location: match.job.location,
      description: match.job.description.slice(0, 18_000),
    })),
  ].join("\n");
}

function updateExtracted(database: JobHuntDatabase, match: RankedMatch, extracted: z.infer<typeof extractedSchema>): void {
  if (!extracted) return;
  const patch: Partial<typeof jobs.$inferInsert> = {};
  if (match.job.salaryMin === null && extracted.salary_min !== undefined) patch.salaryMin = extracted.salary_min;
  if (match.job.salaryMax === null && extracted.salary_max !== undefined) patch.salaryMax = extracted.salary_max;
  if (match.job.currency === null && extracted.currency !== undefined) patch.currency = extracted.currency;
  if (match.job.seniority === null && extracted.seniority !== undefined) patch.seniority = extracted.seniority;
  if (match.job.remoteType === null && extracted.remote_type !== undefined) patch.remoteType = extracted.remote_type;
  if (match.job.stack === null && extracted.stack !== undefined) patch.stack = extracted.stack;
  if (Object.keys(patch).length > 0) database.update(jobs).set(patch).where(eq(jobs.id, match.job.id)).run();
}

/** Stage 3 batch rerank. CLI failures leave retrieval scores intact. */
export async function rerankMatches(input: {
  profile: Profile;
  matches: RankedMatch[];
  database?: JobHuntDatabase;
  providers?: readonly LlmProvider[];
  batchSize?: number;
  now?: Date;
}): Promise<{ scored: number; failed: number }> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? 8;
  let scored = 0;
  let failed = 0;
  for (let offset = 0; offset < input.matches.length; offset += batchSize) {
    const batch = input.matches.slice(offset, offset + batchSize);
    const result = await runStructured({
      task: "rerank",
      prompt: promptFor(input.profile, batch, database),
      promptVersion: "rerank-v4",
      schema: schemaForBatch(batch),
      outputSchema: rerankOutputSchema,
      providers: input.providers,
      database,
      now: () => now,
    });
    if (!result.value) {
      failed += batch.length;
      continue;
    }
    const byId = new Map(result.value.results.map((item) => [item.job_id, item]));
    for (const match of batch) {
      const item = byId.get(match.job.id);
      if (!item) continue;
      database.update(matches).set({
        llmScore: Math.round(item.score),
        reasoning: item.reasoning,
        gaps: item.gaps,
        strengths: item.strengths,
        flags: item.flags,
        provider: result.provider,
        model: result.model,
        cliVersion: result.cliVersion,
        scoredAt: now,
      }).where(eq(matches.jobId, match.job.id)).run();
      updateExtracted(database, match, item.extracted);
      scored += 1;
    }
  }
  return { scored, failed };
}
