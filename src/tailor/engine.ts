import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, displayCompanyName } from "@/db";
import { applications, companies, jobs, resumeVariants } from "@/db/schema";
import type { Profile } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";
import { runStructured } from "@/llm";
import type { LlmProvider } from "@/llm";

import {
  buildGroundedTailoringPlan,
  groundedCoverLetter,
  mergeSelections,
  planWithSelections,
  resumeFromPlan,
  TAILOR_PROMPT_VERSION,
} from "./grounding";
import { renderPdfFromHtml, resumeToHtml } from "./pdf";

const selectedBulletsSchema = z.object({
  experience_index: z.number().int().min(0),
  bullet_indices: z.array(z.number().int().min(0)).max(8),
}).strict();

const selectedProjectBulletsSchema = z.object({
  project_index: z.number().int().min(0),
  bullet_indices: z.array(z.number().int().min(0)).max(8),
}).strict();

const llmEvidenceSchema = z.object({
  requirement: z.string().trim().min(1).max(160),
  source: z.enum(["experience", "project", "skill"]),
  label: z.string().trim().min(1).max(1_000),
  // Native Codex object schemas require every property to be required. Null
  // represents an inapplicable source field rather than an omitted key.
  experience_index: z.number().int().min(0).nullable(),
  bullet_index: z.number().int().min(0).nullable(),
  project_index: z.number().int().min(0).nullable(),
  skill: z.string().trim().min(1).max(160).nullable(),
}).strict();

/**
 * The model can propose source references and an optional narrative. The
 * engine only applies valid source references: prose is generated from those
 * source facts deterministically, so an LLM cannot invent claims or edit a
 * historic job title/date.
 */
export const tailorResponseSchema = z.object({
  selected_bullets: z.array(selectedBulletsSchema),
  project_indices: z.array(z.number().int().min(0)).max(8),
  selected_project_bullets: z.array(selectedProjectBulletsSchema),
  selected_skills: z.array(z.string().trim().min(1).max(160)).max(20),
  headline: z.string().trim().min(1).max(180).nullable(),
  summary: z.string().trim().min(1).max(1_200).nullable(),
  cover_letter: z.string().trim().min(1).max(4_000).nullable(),
  evidence: z.array(llmEvidenceSchema).max(24),
}).strict();

const tailorOutputSchema = z.toJSONSchema(tailorResponseSchema);

export interface TailoredVariant {
  variant: typeof resumeVariants.$inferSelect;
  htmlPath: string;
  pdfPath: string | null;
  llmUsed: boolean;
}

function portfolioFromSummary(profile: Profile): string | undefined {
  const resume = profile.resumeJson;
  if (resume.portfolioUrl) return resume.portfolioUrl;
  return resume.summary?.match(/https?:\/\/[^\s)]+/i)?.[0];
}

function printableResume(profile: Profile, resume: Profile["resumeJson"]) {
  return {
    ...resume,
    portfolioUrl: portfolioFromSummary(profile),
    // `resume.skills` is a capped, role-specific subset persisted on the
    // variant. Do not append every profile skill here or the PDF quietly
    // becomes generic again.
    skills: resume.skills ?? [],
    interests: resume.interests,
  };
}

function llmPrompt(profile: Profile, companyName: string, jobTitle: string, description: string): string {
  const resume = profile.resumeJson;
  return [
    "Create a fact-grounded tailoring PLAN for a resume and cover letter.",
    "Use only the candidate facts supplied below. Never invent employers, job titles, dates, metrics, technologies, outcomes, clearance, citizenship, or years of experience.",
    "Do not edit historic experience titles, employers, dates, or prose. Every historic experience entry and bullet remains in the final resume. The final resume uses exactly one top headline: the target role title supplied below, with no appended skills or alternate titles. Select only source indices and exact skill names supplied below. Multiple selected_bullets objects for the same experience are allowed and will be merged.",
    "Use selected_bullets only to rank source facts: prefer direct required skill or role evidence, then truthful transferable customer, design, delivery, or collaboration facts. Never imply that a transferable fact proves a named technology. Tailor every role, including one with documented gaps: select the strongest truthful source facts rather than returning generic material. Choose 2–3 relevant project_indices, up to 15 exact selected_skills, and relevant experience/project bullet indices. A project marked featured is a user-directed presentation priority and must remain selected; it will appear first in the final resume.",
    "Return every JSON key required by the schema. Use empty arrays when no source is selected, and null for headline, summary, or cover_letter when no safe suggestion exists. headline, summary, cover_letter, and evidence are suggestions only; they must contain no unsupported claim, and the local engine independently validates source references and generates final factual prose.",
    `Target company: ${companyName}`,
    `Target role: ${jobTitle}`,
    `Job description: ${description.slice(0, 18_000)}`,
    `Candidate resume facts (indices are zero-based): ${JSON.stringify(resume)}`,
    `Canonical candidate skills (return exact strings only): ${JSON.stringify(profile.skills)}`,
    `Saved title aliases: ${JSON.stringify(profile.titleAliases)}`,
  ].join("\n\n");
}

function sourceSelectionsFromLlm(value: z.infer<typeof tailorResponseSchema>) {
  return {
    projectIndices: value.project_indices,
    projectBullets: value.selected_project_bullets.map((selection) => ({
      projectIndex: selection.project_index,
      bulletIndices: selection.bullet_indices,
    })),
    experienceBullets: value.selected_bullets.map((selection) => ({
      experienceIndex: selection.experience_index,
      bulletIndices: selection.bullet_indices,
    })),
    skills: value.selected_skills,
  };
}

export async function createTailoredVariant(input: {
  jobId: number;
  profile: Profile;
  database?: JobHuntDatabase;
  allowLlm?: boolean;
  providers?: readonly LlmProvider[];
  now?: Date;
}): Promise<TailoredVariant> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const row = database
    .select({ job: jobs, company: companies })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, input.jobId))
    .get();
  if (!row) throw new Error(`Job ${input.jobId} not found`);

  const companyName = displayCompanyName(row.company.name);
  let plan = buildGroundedTailoringPlan({
    profile: input.profile,
    jobTitle: row.job.title,
    description: row.job.description,
  });
  let llmUsed = false;
  if (input.allowLlm) {
    const result = await runStructured({
      task: "tailor",
      prompt: llmPrompt(input.profile, companyName, row.job.title, row.job.description),
      promptVersion: TAILOR_PROMPT_VERSION,
      schema: tailorResponseSchema,
      outputSchema: tailorOutputSchema,
      providers: input.providers,
      database,
      now: () => now,
    });
    if (result.value) {
      // Source indices are validated against the original profile here, before
      // any target-role ordering happens. This fixes the old index drift bug
      // and merges every selection for the same experience entry.
      const selections = mergeSelections(plan, input.profile, sourceSelectionsFromLlm(result.value));
      plan = planWithSelections({
        profile: input.profile,
        jobTitle: row.job.title,
        plan,
        selections,
      });
      llmUsed = true;
    }
  }

  const resume = resumeFromPlan({
    profile: input.profile,
    jobTitle: row.job.title,
    plan,
  });
  const coverLetter = groundedCoverLetter({
    profile: input.profile,
    companyName,
    jobTitle: row.job.title,
    plan,
  });
  const printable = printableResume(input.profile, resume);
  const variant = database.insert(resumeVariants).values({
    jobId: input.jobId,
    resumeJson: resume,
    coverLetter,
    pdfPath: null,
    profileVersion: input.profile.version,
    jobContentHash: row.job.contentHash,
    promptVersion: TAILOR_PROMPT_VERSION,
    evidenceMap: plan.evidenceMap,
    fitAssessment: plan.fitAssessment,
    createdAt: now,
  }).returning().get()!;

  const exportDirectory = resolve(/* turbopackIgnore: true */ process.env.EXPORT_DIR ?? "data/exports");
  await mkdir(exportDirectory, { recursive: true });
  const htmlPath = join(exportDirectory, `resume-variant-${variant.id}.html`);
  const html = resumeToHtml(printable);
  await writeFile(htmlPath, html, "utf8");
  const pdfPath = join(exportDirectory, `resume-variant-${variant.id}.pdf`);
  const renderedPdf = await renderPdfFromHtml({ html, outputPath: pdfPath });
  const finalVariant = database.update(resumeVariants)
    .set({ pdfPath: renderedPdf })
    .where(eq(resumeVariants.id, variant.id))
    .returning()
    .get()!;
  const application = database.select().from(applications).where(eq(applications.jobId, input.jobId)).get();
  if (application) {
    database.update(applications)
      .set({ resumeVariantId: variant.id, coverLetter, updatedAt: now })
      .where(eq(applications.id, application.id))
      .run();
  }
  return { variant: finalVariant, htmlPath, pdfPath: renderedPdf, llmUsed };
}

export function listResumeVariants(jobId: number, database: JobHuntDatabase = db) {
  return database.select().from(resumeVariants).where(eq(resumeVariants.jobId, jobId)).orderBy(resumeVariants.createdAt).all();
}
