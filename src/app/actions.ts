"use server";

import { redirect } from "next/navigation";

import { db } from "@/db";
import { ensureActiveProfile, saveProfile } from "@/matching";
import { recordTriage } from "@/matching/triage";
import { retrieveMatches } from "@/matching/retrieve";

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
    for (const key of ["name", "email", "phone", "location", "headline", "summary"]) {
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
  redirect("/review?saved=1");
}
