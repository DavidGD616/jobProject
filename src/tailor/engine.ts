import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { applications, companies, jobs, resumeVariants } from "@/db/schema";
import type { Profile, ResumeProfileJson } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";
import { runStructured } from "@/llm";

import { renderPdfFromHtml, resumeToHtml } from "./pdf";

const tailorResponseSchema = z.object({
  selected_bullets: z.array(z.object({
    experience_index: z.number().int().min(0),
    bullet_indices: z.array(z.number().int().min(0)),
    rewrite_suggestions: z.array(z.string()).default([]),
  })).default([]),
  cover_letter: z.string().min(1),
});

export interface TailoredVariant {
  variant: typeof resumeVariants.$inferSelect;
  htmlPath: string;
  pdfPath: string | null;
  llmUsed: boolean;
}

function terms(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^a-z0-9+#./-]+/g, " ").split(/\s+/).filter((term) => term.length > 2));
}

function deterministicResume(resume: ResumeProfileJson, description: string): ResumeProfileJson {
  const jdTerms = terms(description);
  return {
    ...resume,
    experience: (resume.experience ?? []).map((experience) => ({
      ...experience,
      bullets: [...experience.bullets].sort((left, right) => {
        const score = (bullet: string) => [...terms(bullet)].filter((term) => jdTerms.has(term)).length;
        return score(right) - score(left);
      }).slice(0, 5),
    })),
  };
}

function groundedCoverLetter(profile: Profile, companyName: string, jobTitle: string): string {
  const firstExperience = profile.resumeJson.experience?.[0];
  const firstBullet = firstExperience?.bullets[0];
  const evidence = firstExperience && firstBullet
    ? `In my work as ${firstExperience.title} at ${firstExperience.company}, I ${firstBullet.charAt(0).toLowerCase()}${firstBullet.slice(1)}`
    : "My attached resume contains the relevant experience and projects for this role";
  return `Dear ${companyName} hiring team,\n\nI am interested in the ${jobTitle} role. ${evidence}. I would welcome the chance to discuss how that experience could support the team.\n\nThank you,\n${profile.resumeJson.name ?? "[Your name]"}`;
}

function llmPrompt(profile: Profile, companyName: string, jobTitle: string, description: string): string {
  return [
    "Tailor a resume draft using only the supplied candidate facts. Do not invent employers, metrics, dates, technologies, or outcomes.",
    "Return JSON with selected_bullets (valid source indices plus optional rewrite suggestions that remain faithful) and a concise cover_letter draft.",
    `Candidate: ${JSON.stringify(profile.resumeJson)}`,
    `Skills: ${JSON.stringify(profile.skills)}`,
    `Target company: ${companyName}; role: ${jobTitle}`,
    `Job description: ${description.slice(0, 18_000)}`,
  ].join("\n\n");
}

function applySelection(resume: ResumeProfileJson, selected: z.infer<typeof tailorResponseSchema>["selected_bullets"]): ResumeProfileJson {
  if (selected.length === 0) return resume;
  const experience = resume.experience ?? [];
  return {
    ...resume,
    experience: experience.map((item, experienceIndex) => {
      const selection = selected.find((value) => value.experience_index === experienceIndex);
      if (!selection) return item;
      const bullets = selection.bullet_indices
        .map((bulletIndex) => item.bullets[bulletIndex])
        .filter((bullet): bullet is string => Boolean(bullet));
      return bullets.length > 0 ? { ...item, bullets } : item;
    }),
  };
}

export async function createTailoredVariant(input: {
  jobId: number;
  profile: Profile;
  database?: JobHuntDatabase;
  allowLlm?: boolean;
  now?: Date;
}): Promise<TailoredVariant> {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const row = database.select({ job: jobs, company: companies }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, input.jobId)).get();
  if (!row) throw new Error(`Job ${input.jobId} not found`);
  let resume = deterministicResume(input.profile.resumeJson, row.job.description);
  let coverLetter = groundedCoverLetter(input.profile, row.company.name, row.job.title);
  let llmUsed = false;
  if (input.allowLlm) {
    const result = await runStructured({
      task: "tailor",
      prompt: llmPrompt(input.profile, row.company.name, row.job.title, row.job.description),
      promptVersion: "tailor-v1",
      schema: tailorResponseSchema,
      database,
      now: () => now,
    });
    if (result.value) {
      resume = applySelection(resume, result.value.selected_bullets);
      coverLetter = result.value.cover_letter;
      llmUsed = true;
    }
  }
  const variant = database.insert(resumeVariants).values({
    jobId: input.jobId,
    resumeJson: resume,
    coverLetter,
    pdfPath: null,
    createdAt: now,
  }).returning().get()!;
  const exportDirectory = resolve(/* turbopackIgnore: true */ process.env.EXPORT_DIR ?? "data/exports");
  await mkdir(exportDirectory, { recursive: true });
  const htmlPath = join(exportDirectory, `resume-variant-${variant.id}.html`);
  await writeFile(htmlPath, resumeToHtml(resume), "utf8");
  const pdfPath = join(exportDirectory, `resume-variant-${variant.id}.pdf`);
  const renderedPdf = await renderPdfFromHtml({ html: resumeToHtml(resume), outputPath: pdfPath });
  database.update(resumeVariants).set({ pdfPath: renderedPdf }).where(eq(resumeVariants.id, variant.id)).run();
  const application = database.select().from(applications).where(eq(applications.jobId, input.jobId)).get();
  if (application) {
    database.update(applications).set({ resumeVariantId: variant.id, coverLetter, updatedAt: now }).where(eq(applications.id, application.id)).run();
  }
  return { variant: { ...variant, pdfPath: renderedPdf }, htmlPath, pdfPath: renderedPdf, llmUsed };
}

export function listResumeVariants(jobId: number, database: JobHuntDatabase = db) {
  return database.select().from(resumeVariants).where(eq(resumeVariants.jobId, jobId)).orderBy(resumeVariants.createdAt).all();
}
