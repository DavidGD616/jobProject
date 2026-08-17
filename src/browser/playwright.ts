import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import type { CareerPageBrowser } from "@/sources";
import type { LocalBrowserPage } from "@/apply";

export interface LocalChromiumOptions {
  /** Headless is useful for source rendering; forms default to visible. */
  headless?: boolean;
  executablePath?: string;
  timeoutMs?: number;
  userAgent?: string;
}

export interface LocalChromiumSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/** Launch one isolated local Chromium context. No remote browser is used. */
export async function launchLocalChromium(
  options: LocalChromiumOptions = {},
): Promise<LocalChromiumSession> {
  const browser = await chromium.launch({
    headless: options.headless ?? true,
    executablePath: options.executablePath ?? process.env.CHROMIUM_PATH,
    timeout: options.timeoutMs,
  });
  const context = await browser.newContext(
    options.userAgent ? { userAgent: options.userAgent } : undefined,
  );
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    close: () => browser.close(),
  };
}

export function asCareerPageBrowser(
  page: Page,
  timeoutMs = 20_000,
): CareerPageBrowser {
  return {
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5_000) }).catch(() => undefined);
    },
    content: () => page.content(),
  };
}

/**
 * Adapt only the safe form operations used by the apply boundary. The
 * returned object deliberately exposes no click/submit operation.
 */
export function asLocalBrowserPage(
  page: Page,
  timeoutMs = 20_000,
): LocalBrowserPage {
  return {
    async goto(url) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    },
    fill: (selector, value) => page.locator(selector).fill(value, { timeout: timeoutMs }),
    setInputFiles: (selector, path) => page.locator(selector).setInputFiles(path, { timeout: timeoutMs }),
  };
}
