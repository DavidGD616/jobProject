import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { jobs, profiles, triage } from "@/db/schema";
import type { Profile } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";
import { runStructured } from "@/llm";
import type { LlmProvider } from "@/llm";

const expandedQuerySchema = z.union([
  z.object({ terms: z.array(z.object({ term: z.string().min(2), weight: z.number().min(0).max(5) })) }),
  z.array(z.object({ term: z.string().min(2), weight: z.number().min(0).max(5) })).transform((terms) => ({ terms })),
]);

function deterministicTerms(profile: Profile): Record<string, number> {
  const terms = new Map<string, number>();
  for (const skill of profile.skills) terms.set(skill.toLowerCase(), 2);
  for (const title of profile.titleAliases) terms.set(title.toLowerCase(), 2);
  for (const [term, aliases] of Object.entries(profile.skillAliases)) {
    terms.set(term.toLowerCase(), 2);
    for (const alias of aliases) terms.set(alias.toLowerCase(), 1);
  }
  return Object.fromEntries(terms);
}

function promptFor(profile: Profile): string {
  return [
    "Expand the candidate's search language into a small weighted lexical term list.",
    "Return only JSON with terms: [{term, weight}], where weight is 0-5. Include concrete skills, title synonyms, and adjacent technologies. Do not invent skills not implied by the input.",
    `Skills: ${JSON.stringify(profile.skills)}`,
    `Title aliases: ${JSON.stringify(profile.titleAliases)}`,
    `Skill aliases: ${JSON.stringify(profile.skillAliases)}`,
  ].join("\n\n");
}

export async function expandProfileQuery(input: {
  profile: Profile;
  database?: JobHuntDatabase;
  allowLlm?: boolean;
  providers?: readonly LlmProvider[];
  now?: Date;
}): Promise<Profile> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  let queryTerms = deterministicTerms(input.profile);
  if (input.allowLlm) {
    const result = await runStructured({
      task: "expand_query",
      prompt: promptFor(input.profile),
      promptVersion: "query-expand-v1",
      schema: expandedQuerySchema,
      providers: input.providers,
      database,
      now: () => now,
    });
    if (result.value) {
      queryTerms = Object.fromEntries(result.value.terms.map((item) => [item.term.toLowerCase(), item.weight]));
    }
  }
  return database.update(profiles).set({ queryTerms, updatedAt: now }).where(eq(profiles.id, input.profile.id)).returning().get()!;
}

export function fewShotExamples(profileId: number, database: JobHuntDatabase = db): Array<{ title: string; decision: string }> {
  return database.select({ title: jobs.title, decision: triage.decision })
    .from(triage)
    .innerJoin(jobs, eq(triage.jobId, jobs.id))
    .where(and(eq(triage.profileId, profileId), eq(triage.decision, "interested")))
    .orderBy(desc(triage.decidedAt))
    .limit(10)
    .all()
    .concat(database.select({ title: jobs.title, decision: triage.decision })
      .from(triage)
      .innerJoin(jobs, eq(triage.jobId, jobs.id))
      .where(and(eq(triage.profileId, profileId), eq(triage.decision, "skip")))
      .orderBy(desc(triage.decidedAt))
      .limit(10)
      .all());
}
