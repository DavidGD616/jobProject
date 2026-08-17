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
    if (field.key === "resume") await page.setInputFiles(field.selector, field.value);
    else await page.fill(field.selector, field.value);
    filled.push(field.key);
  }
  return { filled, skipped, submissionBlocked: true };
}
