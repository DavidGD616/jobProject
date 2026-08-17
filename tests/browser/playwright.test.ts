import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { chromium } from "playwright";

import { asCareerPageBrowser, launchLocalChromium } from "@/browser/playwright";
import { renderCareerPage } from "@/sources";

test("local Chromium adapter renders a career page snapshot", { skip: !existsSync(chromium.executablePath()) }, async () => {
  const session = await launchLocalChromium({ headless: true });
  try {
    const html = await renderCareerPage(
      asCareerPageBrowser(session.page),
      "data:text/html,<main><h1>Rendered role</h1></main>",
    );
    assert.match(html, /Rendered role/);
  } finally {
    await session.close();
  }
});
