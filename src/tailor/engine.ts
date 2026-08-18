import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db, displayCompanyName } from "@/db";
import { applications, companies, jobs, resumeVariants } from "@/db/schema";
import type { Profile, ResumeProfileJson } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";
import { runStructured } from "@/llm";

import { renderPdfFromHtml, resumeToHtml } from "./pdf";

const tailorResponseSchema = z.object({
  selected_bullets: z.array(z.object({
    experience_index: z.number().int().min(0),
    bullet_indices: z.array(z.number().int().min(0)),
  })).default([]),
});

export interface TailoredVariant {
  variant: typeof resumeVariants.$inferSelect;
  htmlPath: string;
  pdfPath: string | null;
  llmUsed: boolean;
}

const ignoredTerms = new Set([
  "about", "after", "also", "and", "are", "been", "being", "but", "can", "company", "for", "from", "have", "into", "its", "more", "our", "role", "that", "the", "their", "this", "through", "with", "will", "you", "your",
]);

function terms(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/&[a-z]+;/g, " ").replace(/[^a-z0-9+#./-]+/g, " ").split(/\s+/).filter((term) => term.length > 2 && !ignoredTerms.has(term)));
}

function termsOverlap(left: string, right: string): boolean {
  return left === right || (left.length >= 4 && right.length >= 4 && (left.startsWith(right) || right.startsWith(left)));
}

function overlapScore(text: string, jobTerms: Set<string>): number {
  return [...terms(text)].filter((candidateTerm) => [...jobTerms].some((jobTerm) => termsOverlap(candidateTerm, jobTerm))).length;
}

function relevantSkills(skills: readonly string[], jobTerms: Set<string>): string[] {
  return skills.filter((skill) => overlapScore(skill, jobTerms) > 0).slice(0, 10);
}

function portfolioFromSummary(resume: ResumeProfileJson): string | undefined {
  if (resume.portfolioUrl) return resume.portfolioUrl;
  return resume.summary?.match(/https?:\/\/[^\s)]+/i)?.[0];
}

function deterministicResume(resume: ResumeProfileJson, description: string): ResumeProfileJson {
  const jdTerms = terms(description);
  return {
    ...resume,
    projects: [...(resume.projects ?? [])].sort((left, right) => overlapScore(right.description, jdTerms) - overlapScore(left.description, jdTerms)),
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

function printableResume(resume: ResumeProfileJson, profile: Profile, description: string) {
  const jobTerms = terms(description);
  const matched = relevantSkills(profile.skills, jobTerms);
  return {
    ...resume,
    portfolioUrl: portfolioFromSummary(resume),
    skills: [...matched, ...profile.skills.filter((skill) => !matched.includes(skill))],
    interests: resume.interests,
  };
}

function llmPrompt(profile: Profile, companyName: string, jobTitle: string, description: string): string {
  return [
    "Tailor a resume draft using only the supplied candidate facts. Do not invent employers, metrics, dates, technologies, or outcomes.",
    "Return JSON with selected_bullets only. Each selection must contain valid source experience and bullet indices; never return rewritten prose.",
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
  const companyName = displayCompanyName(row.company.name);
  let resume = deterministicResume(input.profile.resumeJson, row.job.description);
  const coverLetter = groundedCoverLetter(input.profile, companyName, row.job.title);
  let llmUsed = false;
  if (input.allowLlm) {
    const result = await runStructured({
      task: "tailor",
      prompt: llmPrompt(input.profile, companyName, row.job.title, row.job.description),
      promptVersion: "tailor-v2",
      schema: tailorResponseSchema,
      database,
      now: () => now,
    });
    if (result.value) {
      resume = applySelection(resume, result.value.selected_bullets);
      llmUsed = true;
    }
  }
  const printable = printableResume(resume, input.profile, row.job.description);
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
  const html = resumeToHtml(printable);
  await writeFile(htmlPath, html, "utf8");
  const pdfPath = join(exportDirectory, `resume-variant-${variant.id}.pdf`);
  const renderedPdf = await renderPdfFromHtml({ html, outputPath: pdfPath });
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
