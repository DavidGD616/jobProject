import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { profiles } from "@/db/schema";
import type {
  NewProfile,
  Profile,
  ProfilePreferences,
  ResumeProfileJson,
} from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

const experienceSchema = z.object({
  company: z.string().trim().min(1),
  title: z.string().trim().min(1),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  bullets: z.array(z.string().trim().min(1)).default([]),
});

export const resumeProfileSchema = z.object({
  name: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  location: z.string().trim().optional(),
  portfolioUrl: z.string().trim().url().optional(),
  headline: z.string().trim().optional(),
  summary: z.string().trim().optional(),
  // Profile skills remain the canonical search vocabulary. This optional field
  // exists for a stored role-specific variant to carry its intentionally
  // shortened display list without losing it during validation.
  skills: z.array(z.string().trim().min(1)).optional(),
  interests: z.array(z.string().trim().min(1)).default([]),
  experience: z.array(experienceSchema).default([]),
  education: z.array(z.object({
    school: z.string().trim().min(1),
    degree: z.string().trim().optional(),
    field: z.string().trim().optional(),
  })).default([]),
  projects: z.array(z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    technologies: z.array(z.string().trim().min(1)).default([]),
    // Optional user-authored proof points give the tailor more than a single
    // project paragraph to select from. They remain source facts, never LLM
    // inventions.
    bullets: z.array(z.string().trim().min(1)).default([]),
  })).default([]),
});

export const preferencesSchema = z.object({
  remoteTypes: z.array(z.enum(["remote", "hybrid", "onsite"])).default([]),
  locations: z.array(z.string().trim().min(1)).default([]),
  minSalary: z.number().int().positive().optional(),
  currencies: z.array(z.string().trim().length(3)).default([]),
  seniorities: z.array(z.string().trim().min(1)).default([]),
  visaKeywords: z.array(z.string().trim().min(1)).default([]),
  exclusions: z.array(z.string().trim().min(1)).default([]),
  targetCompanies: z.array(z.string().trim().min(1)).default([]),
});

export interface ProfileInput {
  resumeJson: ResumeProfileJson;
  skills: string[];
  titleAliases: string[];
  skillAliases: Record<string, string[]>;
  preferences: ProfilePreferences;
  queryTerms?: Record<string, number>;
}

function cleanWords(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export function normalizeProfileInput(input: ProfileInput): ProfileInput {
  const resume = resumeProfileSchema.parse(input.resumeJson);
  const preferences = preferencesSchema.parse(input.preferences);
  const skillAliases = Object.fromEntries(
    Object.entries(input.skillAliases)
      .map(([key, values]) => [key.trim().toLowerCase(), cleanWords(values)])
      .filter(([key]) => Boolean(key)),
  );
  return {
    resumeJson: resume,
    skills: cleanWords(input.skills),
    titleAliases: cleanWords(input.titleAliases),
    skillAliases,
    preferences,
    queryTerms: Object.fromEntries(
      Object.entries(input.queryTerms ?? {}).map(([term, weight]) => [
        term.trim().toLowerCase(),
        Number.isFinite(weight) ? Math.max(0, Math.min(5, weight)) : 1,
      ]),
    ),
  };
}

export function defaultProfileInput(): ProfileInput {
  return {
    resumeJson: { experience: [], education: [], projects: [] },
    skills: [],
    titleAliases: [],
    skillAliases: {},
    preferences: {},
    queryTerms: {},
  };
}

function insertProfile(database: JobHuntDatabase, input: ProfileInput, now: Date): Profile {
  const normalized = normalizeProfileInput(input);
  const values: NewProfile = {
    version: 1,
    resumeJson: normalized.resumeJson,
    skills: normalized.skills,
    titleAliases: normalized.titleAliases,
    skillAliases: normalized.skillAliases,
    queryTerms: normalized.queryTerms ?? {},
    preferences: normalized.preferences,
    updatedAt: now,
  };
  return database.insert(profiles).values(values).returning().get()!;
}

function searchInputsChanged(current: Profile, next: ProfileInput): boolean {
  return JSON.stringify({
    skills: current.skills,
    titleAliases: current.titleAliases,
    skillAliases: current.skillAliases,
  }) !== JSON.stringify({
    skills: next.skills,
    titleAliases: next.titleAliases,
    skillAliases: next.skillAliases,
  });
}

export function getActiveProfile(
  database: JobHuntDatabase = db,
): Profile | null {
  return database.select().from(profiles).orderBy(asc(profiles.id)).limit(1).get() ?? null;
}

export function ensureActiveProfile(
  database: JobHuntDatabase = db,
  now = new Date(),
): Profile {
  return getActiveProfile(database) ?? insertProfile(database, defaultProfileInput(), now);
}

export function saveProfile(
  input: ProfileInput,
  database: JobHuntDatabase = db,
  now = new Date(),
): Profile {
  const current = getActiveProfile(database);
  const normalized = normalizeProfileInput(input);
  if (!current) return insertProfile(database, normalized, now);
  // Query expansion is derived from the profile's search inputs. Retaining it
  // after those inputs change quietly broadens retrieval with stale terms.
  const queryTerms = searchInputsChanged(current, normalized)
    ? {}
    : normalized.queryTerms ?? {};
  return database
    .update(profiles)
    .set({
      version: current.version + 1,
      resumeJson: normalized.resumeJson,
      skills: normalized.skills,
      titleAliases: normalized.titleAliases,
      skillAliases: normalized.skillAliases,
      queryTerms,
      preferences: normalized.preferences,
      updatedAt: now,
    })
    .where(eq(profiles.id, current.id))
    .returning()
    .get()!;
}
