import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { applicationRuns } from "@/db/schema";
import type { JobHuntDatabase } from "@/db";

import type { ApplyPlan } from "./types";

/**
 * Small browser boundary for local Playwright or another local driver. The
 * adapter owns selectors; the caller owns the browser lifecycle. There is
 * intentionally no submit/click method in this interface.
 */
export interface LocalBrowserPage {
  goto(url: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  setInputFiles(selector: string, path: string): Promise<void>;
}

export async function fillApplicationPlan(
  page: LocalBrowserPage,
  plan: ApplyPlan,
): Promise<{ filled: string[]; skipped: string[]; submissionBlocked: true }> {
  await page.goto(plan.url);
  const filled: string[] = [];
  const skipped: string[] = [];
  for (const field of plan.fields) {
    if (!field.selector || !field.value) {
      skipped.push(field.key);
      continue;
    }
    try {
      if (field.key === "resume") await page.setInputFiles(field.selector, field.value);
      else await page.fill(field.selector, field.value);
      filled.push(field.key);
    } catch {
      // A site redesign or a custom field should remain visible to the human
      // reviewer instead of aborting every other declared field.
      skipped.push(field.key);
    }
  }
  return { filled, skipped, submissionBlocked: true };
}

const storedPlanSchema = z.object({
  adapter: z.enum(["greenhouse", "lever", "generic"]),
  url: z.string().url(),
  fields: z.array(z.object({
    key: z.string(),
    label: z.string(),
    value: z.string().nullable(),
    selector: z.string().nullable(),
    required: z.boolean(),
    source: z.enum(["profile", "resume_variant", "job", "human"]),
  })),
  customQuestions: z.array(z.string()),
  submissionBlocked: z.literal(true),
  instructions: z.array(z.string()),
});

export interface ApplicationFillResult {
  runId: number;
  filled: string[];
  skipped: string[];
  submissionBlocked: true;
}

/** Fill one persisted review plan and leave the browser before submission. */
export async function fillApplicationRun(input: {
  runId: number;
  page: LocalBrowserPage;
  database?: JobHuntDatabase;
  now?: Date;
}): Promise<ApplicationFillResult> {
  const database = input.database ?? db;
  const run = database.select().from(applicationRuns).where(eq(applicationRuns.id, input.runId)).get();
  if (!run) throw new Error(`Application run ${input.runId} not found`);
  const parsed = storedPlanSchema.safeParse(run.fields);
  if (!parsed.success) throw new Error(`Application run ${input.runId} has an invalid review plan`);
  const now = input.now ?? new Date();
  try {
    const result = await fillApplicationPlan(input.page, parsed.data);
    database.update(applicationRuns).set({
      status: "filled_for_review",
      fields: { ...parsed.data, fillResult: result },
      finishedAt: now,
      error: null,
    }).where(eq(applicationRuns.id, input.runId)).run();
    return { runId: input.runId, ...result };
  } catch (cause) {
    database.update(applicationRuns).set({
      status: "fill_failed",
      finishedAt: now,
      error: cause instanceof Error ? cause.message : String(cause),
    }).where(eq(applicationRuns.id, input.runId)).run();
    throw cause;
  }
}
