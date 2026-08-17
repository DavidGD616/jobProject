import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { jobs, matches } from "@/db/schema";
import type { Profile } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";
import { runStructured } from "@/llm";
import type { LlmProvider } from "@/llm";

import type { RankedMatch } from "./retrieve";

const extractedSchema = z.object({
  salary_min: z.number().int().nullable().optional(),
  salary_max: z.number().int().nullable().optional(),
  currency: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
  remote_type: z.enum(["remote", "hybrid", "onsite", "unknown"]).nullable().optional(),
  stack: z.array(z.string()).optional(),
}).optional();

const rerankItemSchema = z.object({
  job_id: z.number().int(),
  score: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  gaps: z.array(z.string()).default([]),
  strengths: z.array(z.string()).default([]),
  flags: z.array(z.string()).default([]),
  extracted: extractedSchema,
});

const rerankResponseSchema = z.union([
  z.array(rerankItemSchema),
  z.object({ results: z.array(rerankItemSchema) }).transform((value) => value.results),
]);

function promptFor(profile: Profile, batch: RankedMatch[]): string {
  return [
    "You are ranking job postings against a candidate profile.",
    "Return ONLY a JSON array. Score 90-100 means unusually strong fit; 40 means plausible but significant gaps; below 25 means poor fit.",
    `Candidate profile: ${JSON.stringify(profile)}`,
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
      prompt: promptFor(input.profile, batch),
      promptVersion: "rerank-v1",
      schema: rerankResponseSchema,
      providers: input.providers,
      database,
      now: () => now,
    });
    if (!result.value) {
      failed += batch.length;
      continue;
    }
    const byId = new Map(result.value.map((item) => [item.job_id, item]));
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
