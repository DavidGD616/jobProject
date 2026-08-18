import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } from "@/db/schema";
import { saveProfile } from "@/matching";
import { createTailoredVariant, resumeToHtml } from "@/tailor";
import { buildGroundedTailoringPlan, mergeSelections, planWithSelections, resolveTargetHeadline, resumeFromPlan } from "@/tailor/grounding";
import type { LlmProvider, ProviderResult } from "@/llm";

function createTestDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { applicationRuns, applications, companies, contacts, events, extractionRules, jobs, llmRuns, matches, profiles, rankingFeedback, resumeVariants, sourcePolls, tailorRequests, triage } });
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, sqlite };
}

async function withExportDirectory(run: (directory: string) => Promise<void>) {
  const exportDirectory = await mkdtemp(resolve(tmpdir(), "job-hunt-tailor-test-"));
  const previousExportDirectory = process.env.EXPORT_DIR;
  process.env.EXPORT_DIR = exportDirectory;
  try {
    await run(exportDirectory);
  } finally {
    if (previousExportDirectory === undefined) delete process.env.EXPORT_DIR;
    else process.env.EXPORT_DIR = previousExportDirectory;
    await rm(exportDirectory, { recursive: true, force: true });
  }
}

function insertCompanyAndJob(input: {
  db: ReturnType<typeof createTestDatabase>["db"];
  now: Date;
  title: string;
  description: string;
  contentHash?: string;
}) {
  const company = input.db.insert(companies).values({
    name: "Acme, Inc.",
    slug: "acme",
    discoveredVia: "test",
    discoveredAt: input.now,
    createdAt: input.now,
  }).returning().get()!;
  return input.db.insert(jobs).values({
    companyId: company.id,
    source: "test",
    sourceId: input.title,
    url: "https://example.com/jobs/1",
    title: input.title,
    titleNorm: input.title.toLowerCase(),
    description: input.description,
    firstSeenAt: input.now,
    lastSeenAt: input.now,
    contentHash: input.contentHash ?? "job-content-v1",
  }).returning().get()!;
}

function technicalProfile(db: ReturnType<typeof createTestDatabase>["db"], now: Date) {
  return saveProfile({
    resumeJson: {
      name: "Taylor Example",
      headline: "Full-Stack Software Engineer",
      summary: "Full-stack developer who builds web applications and APIs.",
      experience: [{
        company: "Old Co",
        title: "Software Engineer",
        startDate: "2022",
        endDate: "Present",
        bullets: [
          "Led onboarding sessions for new teammates.",
          "Built TypeScript and Node.js API services for customer workflows.",
          "Created React and Next.js interfaces with automated tests.",
        ],
      }],
      education: [],
      projects: [
        {
          name: "Customer Portal",
          description: "A TypeScript and React portal for customer account workflows. It also includes a low-level audit log.",
          technologies: ["TypeScript", "React", "Next.js"],
          bullets: ["Built account workflows with TypeScript and React.", "Added Next.js pages for customer self-service."],
        },
        {
          name: "Workflow API",
          description: "A Node.js and PostgreSQL service for workflow data.",
          technologies: ["Node.js", "PostgreSQL"],
          bullets: ["Designed PostgreSQL-backed workflow API endpoints."],
        },
        {
          name: "Mobile Sketchbook",
          description: "A Flutter prototype for mobile sketching.",
          technologies: ["Flutter", "Dart"],
        },
      ],
    },
    skills: ["typescript", "react", "next.js", "node.js", "postgresql", "flutter", "dart", "ruby"],
    titleAliases: ["full-stack software engineer"],
    skillAliases: {},
    preferences: {},
  }, db, now);
}

function fakeProvider(text: string, onRun?: (prompt: string, outputSchema: Record<string, unknown> | undefined) => void): LlmProvider {
  const result: ProviderResult = {
    text,
    raw: text,
    provider: "claude",
    model: "fake",
    cliVersion: "fake-1",
    durationMs: 1,
  };
  return {
    id: "claude",
    defaultModel: "fake",
    capabilities: () => ({ structuredOutput: true, maxPromptChars: 80_000, concurrency: 1 }),
    health: async () => true,
    run: async (prompt, options) => {
      onRun?.(prompt, options?.outputSchema);
      return result;
    },
  };
}

test("deterministic tailoring changes the target role evidence without changing historic facts", async () => {
  const { db, sqlite } = createTestDatabase();
  await withExportDirectory(async () => {
    try {
      const now = new Date("2026-08-18T12:00:00.000Z");
      const job = insertCompanyAndJob({
        db,
        now,
        title: "Full Stack Software Engineer",
        description: "Build user-facing TypeScript, React, and Next.js applications. Develop Node.js APIs and PostgreSQL data models. Write automated tests for customer workflows. Translate requirements into functional designs.",
      });
      const profile = technicalProfile(db, now);
      const tailored = await createTailoredVariant({ jobId: job.id, profile, database: db, allowLlm: false, now });
      const resume = tailored.variant.resumeJson;

      assert.equal(tailored.llmUsed, false);
      assert.equal(resume.headline, "Full-Stack Software Engineer");
      assert.match(resume.summary ?? "", /Relevant stack for this Full-Stack Software Engineer role/i);
      assert.ok((resume.projects?.length ?? 0) >= 2);
      assert.ok((resume.projects?.length ?? 0) <= 3);
      assert.deepEqual(resume.projects?.map((project) => project.name), ["Customer Portal", "Workflow API"]);
      assert.ok((resume.skills?.length ?? 0) > 0);
      assert.ok((resume.skills?.length ?? 0) <= 15);
      assert.ok(resume.skills?.includes("TypeScript"));
      assert.ok(resume.skills?.includes("React"));
      assert.ok(!resume.skills?.includes("Flutter"));
      assert.equal(resume.experience?.[0]?.company, "Old Co");
      assert.equal(resume.experience?.[0]?.title, "Software Engineer");
      assert.equal(resume.experience?.[0]?.startDate, "2022");
      assert.equal(resume.experience?.[0]?.endDate, "Present");
      assert.deepEqual(resume.experience?.[0]?.bullets, [
        "Built TypeScript and Node.js API services for customer workflows.",
        "Created React and Next.js interfaces with automated tests.",
        "Led onboarding sessions for new teammates.",
      ]);
      assert.equal(tailored.variant.profileVersion, profile.version);
      assert.equal(tailored.variant.jobContentHash, job.contentHash);
      assert.equal(tailored.variant.promptVersion, "tailor-v9");
      assert.equal(tailored.variant.fitAssessment?.level, "strong");
      assert.ok((tailored.variant.evidenceMap ?? []).some((item) => item.source === "project"));
      assert.ok((tailored.variant.evidenceMap ?? []).some((item) => item.source === "experience"));
      assert.match(tailored.variant.coverLetter ?? "", /Full Stack Software Engineer/);
      assert.match(tailored.variant.coverLetter ?? "", /TypeScript/i);
      assert.match(tailored.variant.coverLetter ?? "", /Customer Portal|Workflow API/);
      assert.doesNotMatch(tailored.variant.coverLetter ?? "", /\.\./);
      assert.doesNotMatch(tailored.variant.coverLetter ?? "", /low-level audit log/i);

      const html = await readFile(tailored.htmlPath, "utf8");
      assert.match(html, /Customer Portal/);
      assert.doesNotMatch(html, /Mobile Sketchbook/);
      assert.match(resumeToHtml(resume), /Taylor Example/);
    } finally {
      sqlite.close();
    }
  });
});

test("tailoring retains historical work while foregrounding transferable facts and a featured project", async () => {
  const { db, sqlite } = createTestDatabase();
  await withExportDirectory(async () => {
    try {
      const now = new Date("2026-08-18T12:00:00.000Z");
      const job = insertCompanyAndJob({
        db,
        now,
        title: "Full Stack Software Engineer",
        description: "Build TypeScript, React, and Next.js applications with PostgreSQL. Translate customer requirements into functional interface designs and partner with cross-functional teams to deliver production workflows.",
      });
      const profile = saveProfile({
        resumeJson: {
          name: "Taylor Example",
          headline: "Applied AI & Full-Stack Software Engineer",
          summary: "Applied AI and full-stack engineer.",
          experience: [{
            company: "TaylorMade Golf",
            title: "Digital Design & Production Specialist",
            startDate: "2021",
            endDate: "Present",
            bullets: [
              "Maintained production asset libraries across campaigns.",
              "Translated client requirements into production-ready visual workflows.",
              "Coordinated delivery reviews with cross-functional partners.",
            ],
          }],
          education: [],
          projects: [
            {
              name: "Customer Portal",
              description: "A TypeScript, React, and Next.js portal for customer account workflows.",
              technologies: ["TypeScript", "React", "Next.js"],
            },
            {
              name: "StrivIQ",
              description: "A Flutter fitness application using Supabase and PostgreSQL workflows.",
              technologies: ["Flutter", "Dart", "Supabase", "PostgreSQL"],
              featured: true,
              completedAt: "2026-08",
            },
          ],
        },
        skills: ["typescript", "react", "next.js", "postgresql", "flutter"],
        titleAliases: ["full-stack software engineer"],
        skillAliases: {},
        preferences: {},
      }, db, now);
      const tailored = await createTailoredVariant({ jobId: job.id, profile, database: db, allowLlm: false, now });
      const resume = tailored.variant.resumeJson;

      assert.equal(resume.headline, "Full-Stack Software Engineer");
      assert.equal(resume.experience?.[0]?.title, "Digital Design & Production Specialist");
      assert.equal(resume.experience?.[0]?.company, "TaylorMade Golf");
      assert.equal(resume.experience?.[0]?.startDate, "2021");
      assert.equal(resume.experience?.[0]?.endDate, "Present");
      assert.equal(
        resume.experience?.[0]?.bullets?.[0],
        "Translated client requirements into production-ready visual workflows.",
      );
      assert.deepEqual([...resume.experience?.[0]?.bullets ?? []].sort(), [
        "Maintained production asset libraries across campaigns.",
        "Translated client requirements into production-ready visual workflows.",
        "Coordinated delivery reviews with cross-functional partners.",
      ].sort());
      assert.deepEqual(resume.projects?.map((project) => project.name), ["StrivIQ", "Customer Portal"]);
      assert.equal(resume.projects?.[0]?.featured, true);
      assert.equal(resume.projects?.[0]?.completedAt, "2026-08");
    } finally {
      sqlite.close();
    }
  });
});

test("all explicitly featured projects survive the normal relevance cap", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const source = technicalProfile(db, now);
    const profile = saveProfile({
      resumeJson: {
        ...source.resumeJson,
        projects: [
          ...(source.resumeJson.projects ?? []).map((project) => ({ ...project, featured: true })),
          {
            name: "Architecture Notes",
            description: "A small set of architecture notes for local development workflows.",
            featured: true,
          },
        ],
      },
      skills: source.skills,
      titleAliases: source.titleAliases,
      skillAliases: source.skillAliases,
      preferences: source.preferences,
    }, db, now);
    const plan = buildGroundedTailoringPlan({
      profile,
      jobTitle: "Full Stack Software Engineer",
      description: "Build TypeScript and React applications with Node.js and PostgreSQL.",
    });
    const selections = mergeSelections(plan, profile, { projectIndices: [] });
    const planWithAllFeatured = planWithSelections({
      profile,
      jobTitle: "Full Stack Software Engineer",
      plan,
      selections,
    });
    const resume = resumeFromPlan({
      profile,
      jobTitle: "Full Stack Software Engineer",
      plan: planWithAllFeatured,
    });

    assert.deepEqual([...planWithAllFeatured.selections.projectIndices], [0, 1, 2, 3]);
    assert.deepEqual(resume.projects?.map((project) => project.name), [
      "Customer Portal",
      "Workflow API",
      "Mobile Sketchbook",
      "Architecture Notes",
    ]);
  } finally {
    sqlite.close();
  }
});

test("headline policy accepts a grounded normalized role title and rejects unsupported seniority or technology", () => {
  const { db, sqlite } = createTestDatabase();
  try {
    const now = new Date("2026-08-18T12:00:00.000Z");
    const profile = technicalProfile(db, now);
    const input = {
      profile,
      jobTitle: "Senior Ruby Platform Engineer",
      description: "Build Ruby platform services with TypeScript and React.",
    };

    // Ruby is a saved skill, but it is not a saved professional title. A
    // skill by itself must not turn into a stronger top-of-resume claim.
    assert.equal(resolveTargetHeadline({ ...input, proposedHeadline: "Senior Ruby Platform Engineer" }), "Full-Stack Software Engineer");
    assert.equal(resolveTargetHeadline({ ...input, proposedHeadline: "Ruby Software Engineer" }), "Full-Stack Software Engineer");
  } finally {
    sqlite.close();
  }
});

test("LLM may choose one concise role title grounded in transferable profile evidence", async () => {
  const { db, sqlite } = createTestDatabase();
  await withExportDirectory(async () => {
    try {
      const now = new Date("2026-08-18T12:00:00.000Z");
      const job = insertCompanyAndJob({
        db,
        now,
        title: "Hazard Zone Senior Deployment Lead",
        description: "Lead operational deployments, coordinate delivery handoffs, and improve deployment workflows.",
      });
      const profile = saveProfile({
        resumeJson: {
          name: "Taylor Example",
          headline: "Operations Lead",
          summary: "Operations professional focused on reliable delivery.",
          experience: [{
            company: "Old Co",
            title: "Production Coordinator",
            bullets: ["Coordinated deployment readiness and operational handoffs across delivery teams."],
          }],
          education: [],
          projects: [],
        },
        skills: [],
        titleAliases: ["operations lead"],
        skillAliases: {},
        preferences: {},
      }, db, now);
      const tailored = await createTailoredVariant({
        jobId: job.id,
        profile,
        database: db,
        allowLlm: true,
        providers: [fakeProvider(JSON.stringify({
          selected_bullets: [{ experience_index: 0, bullet_indices: [0] }],
          project_indices: [],
          selected_project_bullets: [],
          selected_skills: [],
          headline: "Operations & Deployment Lead",
          summary: null,
          cover_letter: null,
          evidence: [],
        }))],
        now,
      });

      assert.equal(tailored.variant.resumeJson.headline, "Operations & Deployment Lead");
      assert.notEqual(tailored.variant.resumeJson.headline, job.title);
      assert.equal(tailored.variant.resumeJson.experience?.[0]?.title, "Production Coordinator");
    } finally {
      sqlite.close();
    }
  });
});

test("an unrelated featured project and production bullet stay on the resume but out of the cover letter", async () => {
  const { db, sqlite } = createTestDatabase();
  await withExportDirectory(async () => {
    try {
      const now = new Date("2026-08-18T12:00:00.000Z");
      const job = insertCompanyAndJob({
        db,
        now,
        title: "TypeScript Engineer",
        description: "Build TypeScript and React web applications.",
      });
      const profile = saveProfile({
        resumeJson: {
          name: "Taylor Example",
          headline: "Full-Stack Software Engineer",
          summary: "Full-stack engineer.",
          experience: [{
            company: "TaylorMade Golf",
            title: "Digital Design & Production Specialist",
            bullets: ["Managed laser engraving equipment for retail signage."],
          }],
          education: [],
          projects: [{
            name: "Laser Engraving Portfolio",
            description: "A gallery of engraved retail artwork.",
            featured: true,
          }],
        },
        skills: ["typescript", "react"],
        titleAliases: ["full-stack software engineer"],
        skillAliases: {},
        preferences: {},
      }, db, now);
      const tailored = await createTailoredVariant({
        jobId: job.id,
        profile,
        database: db,
        allowLlm: true,
        providers: [fakeProvider(JSON.stringify({
          selected_bullets: [{ experience_index: 0, bullet_indices: [0] }],
          project_indices: [0],
          selected_project_bullets: [],
          selected_skills: ["typescript", "react"],
          headline: null,
          summary: null,
          cover_letter: null,
          evidence: [],
        }))],
        now,
      });

      assert.deepEqual(tailored.variant.resumeJson.experience?.[0]?.bullets, [
        "Managed laser engraving equipment for retail signage.",
      ]);
      assert.deepEqual(tailored.variant.resumeJson.projects?.map((project) => project.name), ["Laser Engraving Portfolio"]);
      assert.equal(tailored.variant.coverLetter, null);
      assert.ok(!(tailored.variant.evidenceMap ?? []).some((item) => /TaylorMade|laser engraving/i.test(item.label)));
    } finally {
      sqlite.close();
    }
  });
});

test("LLM source selections merge repeated experience references against original indices", async () => {
  const { db, sqlite } = createTestDatabase();
  await withExportDirectory(async () => {
    try {
      const now = new Date("2026-08-18T12:00:00.000Z");
      const job = insertCompanyAndJob({
        db,
        now,
        title: "TypeScript Engineer",
        description: "Build TypeScript services and React and Next.js interfaces for customer workflows.",
      });
      const profile = technicalProfile(db, now);
      let prompt = "";
      let outputSchema: Record<string, unknown> | undefined;
      const tailored = await createTailoredVariant({
        jobId: job.id,
        profile,
        database: db,
        allowLlm: true,
        providers: [fakeProvider(JSON.stringify({
          selected_bullets: [
            { experience_index: 0, bullet_indices: [0] },
            { experience_index: 0, bullet_indices: [1, 2] },
            { experience_index: 99, bullet_indices: [0] },
          ],
          project_indices: [0, 1, 99],
          selected_project_bullets: [{ project_index: 0, bullet_indices: [0, 99] }],
          selected_skills: ["typescript", "react", "not-a-profile-skill"],
          headline: "Chief Architect with invented credentials",
          summary: null,
          cover_letter: "Invented letter",
          evidence: [],
        }), (value, schema) => { prompt = value; outputSchema = schema; })],
        now,
      });
      const resume = tailored.variant.resumeJson;

      assert.equal(tailored.llmUsed, true);
      assert.match(prompt, /fact-grounded tailoring PLAN/i);
      assert.match(prompt, /Every historic experience entry and bullet remains/i);
      assert.match(prompt, /exactly one top headline/i);
      assert.match(prompt, /not a copied job-posting label/i);
      assert.match(prompt, /selected_bullets only to rank source facts/i);
      assert.match(prompt, /Tailor every role, including one with documented gaps/i);
      assert.ok(outputSchema);
      const schemaProperties = outputSchema.properties as Record<string, unknown>;
      const schemaRequired = outputSchema.required as string[];
      assert.deepEqual([...schemaRequired].sort(), Object.keys(schemaProperties).sort());
      assert.deepEqual(resume.experience?.[0]?.bullets, [
        "Built TypeScript and Node.js API services for customer workflows.",
        "Created React and Next.js interfaces with automated tests.",
        "Led onboarding sessions for new teammates.",
      ]);
      assert.equal(resume.experience?.[0]?.title, "Software Engineer");
      assert.equal(resume.experience?.[0]?.startDate, "2022");
      assert.equal(resume.experience?.[0]?.endDate, "Present");
      assert.doesNotMatch(resume.headline ?? "", /Chief Architect/);
      assert.equal(resume.headline, "Full-Stack Software Engineer");
      assert.ok(!resume.skills?.includes("not-a-profile-skill"));
      assert.equal(tailored.variant.promptVersion, "tailor-v9");
    } finally {
      sqlite.close();
    }
  });
});

test("Ruby, clearance, and seniority gaps retain a low-fit review while producing grounded materials", async () => {
  const { db, sqlite } = createTestDatabase();
  await withExportDirectory(async () => {
    try {
      const now = new Date("2026-08-18T12:00:00.000Z");
      const job = insertCompanyAndJob({
        db,
        now,
        title: "Senior Ruby Platform Engineer",
        description: "Requires 5+ years of professional Ruby on Rails experience and an active Secret clearance. Build secure platform services with TypeScript and React for customer workflows.",
      });
      const profile = technicalProfile(db, now);
      // Ruby is deliberately not part of the saved profile facts for this role.
      const profileWithoutRuby = saveProfile({
        resumeJson: profile.resumeJson,
        skills: profile.skills.filter((skill) => skill !== "ruby"),
        titleAliases: profile.titleAliases,
        skillAliases: profile.skillAliases,
        preferences: profile.preferences,
      }, db, now);
      const tailored = await createTailoredVariant({ jobId: job.id, profile: profileWithoutRuby, database: db, allowLlm: false, now });

      assert.equal(tailored.variant.fitAssessment?.level, "low");
      assert.match(tailored.variant.fitAssessment?.gaps.join(" ") ?? "", /Ruby/i);
      assert.match(tailored.variant.fitAssessment?.gaps.join(" ") ?? "", /clearance/i);
      assert.match(tailored.variant.fitAssessment?.gaps.join(" ") ?? "", /years|senior/i);
      assert.match(tailored.variant.fitAssessment?.summary ?? "", /requirements are not documented/i);
      assert.equal(tailored.variant.resumeJson.headline, "Full-Stack Software Engineer");
      assert.match(tailored.variant.resumeJson.summary ?? "", /Relevant stack for this Full-Stack Software Engineer role/i);
      assert.match(tailored.variant.resumeJson.summary ?? "", /TypeScript/i);
      assert.match(tailored.variant.coverLetter ?? "", /Senior Ruby Platform Engineer/);
      assert.match(tailored.variant.coverLetter ?? "", /Customer Portal|Workflow API|Old Co/);
      assert.doesNotMatch(tailored.variant.coverLetter ?? "", /Rails|clearance|5\+ years/i);
      assert.equal(tailored.variant.resumeJson.experience?.[0]?.title, "Software Engineer");
      assert.equal(tailored.variant.resumeJson.experience?.[0]?.startDate, "2022");
      assert.equal(tailored.variant.resumeJson.experience?.[0]?.bullets.length, 3);
      assert.deepEqual(tailored.variant.resumeJson.projects?.map((project) => project.name), ["Customer Portal"]);
      assert.ok(!tailored.variant.resumeJson.skills?.includes("ruby"));
    } finally {
      sqlite.close();
    }
  });
});
