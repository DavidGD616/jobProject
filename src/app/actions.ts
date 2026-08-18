"use server";

import { redirect } from "next/navigation";

import { db, enqueueTailorRequest, updateResumeVariantCoverLetter } from "@/db";
import { ensureActiveProfile, saveProfile } from "@/matching";
import { recordTriage } from "@/matching/triage";
import { retrieveMatches } from "@/matching/retrieve";
import {
  applicationStatuses,
  createApplication,
  saveContact,
  updateApplication,
} from "@/tracking";
import { prepareApplication } from "@/apply";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function csv(formData: FormData, key: string): string[] {
  return text(formData, key).split(",").map((value) => value.trim()).filter(Boolean);
}

function parseJson(formData: FormData, key: string, fallback: unknown): unknown {
  const value = text(formData, key);
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${key} must contain valid JSON`);
  }
}

export async function saveProfileAction(formData: FormData): Promise<void> {
  try {
    const current = ensureActiveProfile(db);
    const resumeJson = parseJson(formData, "resume_json", current.resumeJson) as Record<string, unknown>;
    for (const key of ["name", "email", "phone", "location", "portfolioUrl", "headline", "summary"]) {
      const value = text(formData, key);
      if (value) resumeJson[key] = value;
      else delete resumeJson[key];
    }
    const skillAliases = parseJson(formData, "skill_aliases", current.skillAliases);
    const remoteTypes = formData.getAll("remote_types").map(String).filter((value) => ["remote", "hybrid", "onsite"].includes(value)) as Array<"remote" | "hybrid" | "onsite">;
    const minimumSalary = text(formData, "min_salary");
    const minSalary = minimumSalary ? Number(minimumSalary) : undefined;
    saveProfile({
      resumeJson: resumeJson as never,
      skills: csv(formData, "skills"),
      titleAliases: csv(formData, "title_aliases"),
      skillAliases: skillAliases as Record<string, string[]>,
      preferences: {
        remoteTypes,
        locations: csv(formData, "locations"),
        minSalary: minSalary && Number.isFinite(minSalary) ? minSalary : undefined,
        currencies: csv(formData, "currencies"),
        seniorities: csv(formData, "seniorities"),
        visaKeywords: csv(formData, "visa_keywords"),
        exclusions: csv(formData, "exclusions"),
        targetCompanies: csv(formData, "target_companies"),
      },
      queryTerms: current.queryTerms,
    }, db);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Could not save profile";
    redirect(`/profile?error=${encodeURIComponent(message.slice(0, 160))}`);
  }
  redirect("/profile?saved=1");
}

export async function refreshMatchesAction(): Promise<void> {
  const profile = ensureActiveProfile(db);
  retrieveMatches(profile, { database: db, limit: 100 });
  redirect("/review?refreshed=1");
}

export async function triageAction(formData: FormData): Promise<void> {
  const jobId = Number(text(formData, "job_id"));
  const profileId = Number(text(formData, "profile_id"));
  const companyId = Number(text(formData, "company_id"));
  const decision = text(formData, "decision");
  if (!Number.isInteger(jobId) || !Number.isInteger(profileId) || !["interested", "skip", "block_company"].includes(decision)) {
    redirect("/review?error=Invalid+triage+request");
  }
  recordTriage({
    jobId,
    profileId,
    companyId: Number.isInteger(companyId) ? companyId : undefined,
    decision: decision as "interested" | "skip" | "block_company",
    reason: text(formData, "reason") || null,
    database: db,
  });
  if (decision === "interested") redirect(`/jobs/${jobId}?interested=1`);
  redirect("/review?saved=1");
}

export async function createApplicationAction(formData: FormData): Promise<void> {
  const jobId = Number(text(formData, "job_id"));
  if (!Number.isInteger(jobId)) redirect("/pipeline?error=Invalid+job");
  createApplication({ jobId, notes: text(formData, "notes") || null, database: db });
  redirect("/pipeline?saved=1");
}

export async function updateApplicationAction(formData: FormData): Promise<void> {
  const id = Number(text(formData, "application_id"));
  const status = text(formData, "status");
  if (!Number.isInteger(id) || !applicationStatuses.includes(status as (typeof applicationStatuses)[number])) {
    redirect("/pipeline?error=Invalid+application+update");
  }
  const followup = text(formData, "next_followup");
  updateApplication({
    id,
    status: status as (typeof applicationStatuses)[number],
    notes: text(formData, "notes") || null,
    nextFollowupAt: followup ? new Date(`${followup}T09:00:00.000Z`) : null,
    database: db,
  });
  redirect("/pipeline?saved=1");
}

export async function addContactAction(formData: FormData): Promise<void> {
  const companyId = Number(text(formData, "company_id"));
  if (!Number.isInteger(companyId)) redirect("/pipeline?error=Invalid+company");
  saveContact({
    companyId,
    name: text(formData, "name"),
    role: text(formData, "role"),
    email: text(formData, "email"),
    linkedin: text(formData, "linkedin"),
    notes: text(formData, "contact_notes"),
    database: db,
  });
  redirect("/pipeline?saved=1");
}

/** Queue work for the local tailor CLI; request handlers never launch Chromium. */
export async function queueTailorVariantAction(formData: FormData): Promise<void> {
  const jobId = Number(text(formData, "job_id"));
  if (!Number.isInteger(jobId)) redirect("/tailor?error=Invalid+job");
  enqueueTailorRequest({ jobId, database: db });
  redirect("/tailor?queued=1");
}

export async function updateCoverLetterAction(formData: FormData): Promise<void> {
  const variantId = Number(text(formData, "variant_id"));
  if (!Number.isInteger(variantId)) redirect("/tailor?error=Invalid+resume+variant");
  updateResumeVariantCoverLetter({
    variantId,
    coverLetter: text(formData, "cover_letter"),
    database: db,
  });
  redirect("/tailor?letter_saved=1");
}

export async function prepareApplicationAction(formData: FormData): Promise<void> {
  const applicationId = Number(text(formData, "application_id"));
  if (!Number.isInteger(applicationId)) redirect("/apply?error=Invalid+application");
  await prepareApplication({ applicationId, profile: ensureActiveProfile(db), database: db });
  redirect("/apply?saved=1");
}
