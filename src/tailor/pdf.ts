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

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function inlineText(value: string): string {
  return escapeHtml(value).replace(/\n+/g, " ");
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value;
}

function sectionHeading(label: string, detail?: string): string {
  return `<div class="section-heading"><span>${escapeHtml(label)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</div>`;
}

function bulletList(items: readonly string[], className = ""): string {
  if (items.length === 0) return "";
  return `<ul${className ? ` class="${className}"` : ""}>${items.map((item) => `<li>${inlineText(item)}</li>`).join("")}</ul>`;
}

export interface PrintableResume {
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  portfolioUrl?: string;
  headline?: string;
  summary?: string;
  skills?: string[];
  interests?: string[];
  experience?: Array<{ company: string; title: string; startDate?: string; endDate?: string; bullets: string[] }>;
  education?: Array<{ school: string; degree?: string; field?: string }>;
  projects?: Array<{ name: string; description: string; technologies?: string[]; bullets?: string[] }>;
}

function contactLine(resume: PrintableResume): string {
  const contact = [resume.email, resume.phone ? formatPhone(resume.phone) : undefined, resume.location].filter(Boolean).map((value) => inlineText(value!));
  const portfolio = safeUrl(resume.portfolioUrl ?? "");
  if (portfolio) contact.push(`<a href="${escapeHtml(portfolio)}">${inlineText(portfolio.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>`);
  return contact.join(`<span class="dot">·</span>`);
}

function renderExperience(resume: PrintableResume): string {
  return (resume.experience ?? []).map((item) => {
    const dates = item.startDate ? `${inlineText(item.startDate)}–${inlineText(item.endDate ?? "Present")}` : "";
    return `<article class="entry"><div class="entry-top"><div><h3>${inlineText(item.title)}</h3><p class="entry-company">${inlineText(item.company)}</p></div>${dates ? `<p class="entry-dates">${dates}</p>` : ""}</div>${bulletList(item.bullets, "resume-bullets")}</article>`;
  }).join("");
}

function renderProjects(resume: PrintableResume): string {
  return (resume.projects ?? []).map((item) => `<article class="project"><h3>${inlineText(item.name)}</h3><p>${inlineText(item.description)}</p>${bulletList(item.bullets ?? [], "resume-bullets")}${item.technologies?.length ? `<p class="techline"><span>Built with</span> ${item.technologies.map(inlineText).join(`<span class="tech-dot">·</span>`)}</p>` : ""}</article>`).join("");
}

function renderEducation(resume: PrintableResume): string {
  return (resume.education ?? []).map((item) => `<article class="entry education-entry"><div class="entry-top"><div><h3>${inlineText(item.school)}</h3><p class="entry-company">${inlineText([item.degree, item.field].filter(Boolean).join(" · "))}</p></div></div></article>`).join("");
}

export function resumeToHtml(resume: PrintableResume): string {
  const skills = resume.skills?.length ? `<section>${sectionHeading("Skills & technologies")}<div class="skill-list">${resume.skills.map((skill) => `<span>${inlineText(skill)}</span>`).join("")}</div></section>` : "";
  const interests = resume.interests?.length ? `<section>${sectionHeading("Interests")}<p class="interest-line">${resume.interests.map(inlineText).join(`<span class="tech-dot">·</span>`)}</p></section>` : "";
  const summaryText = resume.portfolioUrl ? resume.summary?.replace(/Portfolio:\s*https?:\/\/[^\s)]+/i, "").replace(/\n{3,}/g, "\n\n").trim() : resume.summary;
  const summary = summaryText ? `<section class="summary-section">${sectionHeading("Profile")}<p class="summary">${inlineText(summaryText)}</p></section>` : "";
  const experience = resume.experience?.length ? `<section>${sectionHeading("Professional experience")}${renderExperience(resume)}</section>` : "";
  const projects = resume.projects?.length ? `<section>${sectionHeading("Selected projects")}${renderProjects(resume)}</section>` : "";
  const education = resume.education?.length ? `<section>${sectionHeading("Education")}${renderEducation(resume)}</section>` : "";
  const contact = contactLine(resume);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${inlineText(resume.name ?? "Resume")}</title><style>
@page{size:Letter;margin:0.46in 0.56in 0.48in}*{box-sizing:border-box}html{background:#fff}body{margin:0;background:#fff;color:#111;font-family:"Times New Roman",Times,serif;font-size:9.65pt;line-height:1.32;-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit;text-decoration:underline;text-underline-offset:2px}.resume-page{max-width:7.4in;margin:0 auto}.masthead{border-bottom:1px solid #111;padding:0 0 10px;text-align:center}.name{display:block;font-family:"Times New Roman",Times,serif;font-size:22.5pt;line-height:1.04;letter-spacing:.035em;text-transform:uppercase;margin:0;color:#111}.headline{display:block;font-size:10.8pt;margin:4px 0 3px}.contact{font-family:Arial,Helvetica,sans-serif;color:#222;font-size:8pt;display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:0}.contact a{color:#111}.dot{color:#111;font-weight:400;padding:0 4px}.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px;border-bottom:1px solid #111;padding-bottom:2px;margin:12px 0 6px;color:#111;font-size:10pt;font-weight:700;letter-spacing:.01em;text-transform:uppercase}.section-heading small{font-family:Arial,Helvetica,sans-serif;font-size:7.2pt;color:#333;font-weight:400;letter-spacing:0;text-transform:none;text-align:right}.summary-section{max-width:7.1in}.summary{font-size:9.55pt;line-height:1.34;margin:0;white-space:pre-line}.entry,.project{break-inside:avoid;margin:0 0 7px}.entry-top{display:flex;justify-content:space-between;gap:13px;align-items:baseline}.entry h3,.project h3{font-size:10.5pt;line-height:1.1;margin:0;font-weight:700}.entry-company{font-weight:400;margin:1px 0 0;font-size:8.8pt}.entry-dates{font-family:Arial,Helvetica,sans-serif;font-size:7.6pt;white-space:nowrap;margin:0}.resume-bullets{margin:3px 0 0;padding-left:16px}.resume-bullets li{margin:1.5px 0;padding-left:1px}.project{padding:0}.project p{margin:3px 0 0}.techline,.matched-skills,.interest-line{font-family:Arial,Helvetica,sans-serif;font-size:7.6pt!important;color:#222!important;line-height:1.32;margin-top:3px!important}.techline span:first-child,.matched-skills span:first-child{font-weight:700;color:#111;text-transform:none;letter-spacing:0;font-size:7.6pt;margin-right:2px}.tech-dot{color:#111;font-weight:400;padding:0 3px}.skill-list{font-size:8.05pt;line-height:1.36}.skill-list span:not(:last-child)::after{content:"; ";}.education-entry{margin-bottom:3px}@media print{html{background:#fff}.resume-page{max-width:none}}
</style></head><body><div class="resume-page"><header class="masthead"><h1 class="name">${inlineText(resume.name ?? "")}</h1>${resume.headline ? `<p class="headline">${inlineText(resume.headline)}</p>` : ""}<p class="contact">${contact}</p></header><main>${summary}${experience}${projects}${education}${skills}${interests}</main></div></body></html>`;
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
          margin: { top: "0.52in", right: "0.58in", bottom: "0.55in", left: "0.58in" },
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
