import { readFile } from "node:fs/promises";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]!);
}

export interface PrintableResume {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  headline?: string;
  summary?: string;
  experience?: Array<{ company: string; title: string; startDate?: string; endDate?: string; bullets: string[] }>;
  education?: Array<{ school: string; degree?: string; field?: string }>;
  projects?: Array<{ name: string; description: string; technologies?: string[] }>;
}

export function resumeToHtml(resume: PrintableResume): string {
  const experience = (resume.experience ?? []).map((item) => `<section><h2>${escapeHtml(item.title)}</h2><p class="meta">${escapeHtml(item.company)}${item.startDate ? ` · ${escapeHtml(item.startDate)}–${escapeHtml(item.endDate ?? "Present")}` : ""}</p><ul>${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul></section>`).join("");
  const education = (resume.education ?? []).map((item) => `<section><h2>${escapeHtml(item.school)}</h2><p class="meta">${escapeHtml([item.degree, item.field].filter(Boolean).join(" · "))}</p></section>`).join("");
  const projects = (resume.projects ?? []).map((item) => `<section><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.description)}</p>${item.technologies?.length ? `<p class="meta">${escapeHtml(item.technologies.join(" · "))}</p>` : ""}</section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(resume.name ?? "Resume")}</title><style>@page{size:letter;margin:0.65in}*{box-sizing:border-box}body{font-family:Georgia,serif;color:#1d2b32;line-height:1.4;font-size:10.5pt}h1{font-size:25pt;line-height:1;margin:0 0 5pt;letter-spacing:-.04em}h2{font-size:12pt;margin:13pt 0 1pt;color:#1d2b32}p{margin:4pt 0}.contact,.meta{font-family:Arial,sans-serif;font-size:8.5pt;color:#526267}.headline{font-size:11pt;font-weight:bold;margin-top:8pt}.summary{margin-top:12pt;border-top:1px solid #d8c8aa;padding-top:8pt}ul{margin:4pt 0;padding-left:18pt}li{margin:2pt 0}section{break-inside:avoid}</style></head><body><h1>${escapeHtml(resume.name ?? "")}</h1><p class="contact">${escapeHtml([resume.email, resume.phone, resume.location].filter(Boolean).join(" · "))}</p>${resume.headline ? `<p class="headline">${escapeHtml(resume.headline)}</p>` : ""}${resume.summary ? `<p class="summary">${escapeHtml(resume.summary)}</p>` : ""}${experience}${projects}${education}</body></html>`;
}

/** Render through the locally installed Playwright Chromium binary. */
export async function renderPdfFromHtml(input: {
  html: string;
  outputPath: string;
  chromiumPath?: string;
  timeoutMs?: number;
}): Promise<string | null> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  let browser: import("playwright").Browser | undefined;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: true,
      executablePath: input.chromiumPath ?? process.env.CHROMIUM_PATH,
      timeout: timeoutMs,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent(input.html, { waitUntil: "load", timeout: timeoutMs });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        page.pdf({
          path: input.outputPath,
          format: "Letter",
          printBackground: true,
          margin: { top: "0.65in", right: "0.65in", bottom: "0.65in", left: "0.65in" },
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Chromium PDF rendering timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return input.outputPath;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (/executable doesn't exist|executable path|browserType\.launch|ENOENT|not found|cannot execute/i.test(message)) return null;
    throw cause;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

export async function readExport(path: string): Promise<Buffer> {
  return readFile(path);
}
