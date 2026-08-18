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

function sectionHeading(label: string, detail?: string): string {
  return `<div class="section-heading"><span>${escapeHtml(label)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</div>`;
}

function bulletList(items: readonly string[], className = "") : string {
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
  targetRole?: string;
  targetCompany?: string;
  postingSignals?: string[];
  relevantSkills?: string[];
  relevantEvidence?: Array<{ label: string; text: string }>;
  experience?: Array<{ company: string; title: string; startDate?: string; endDate?: string; bullets: string[] }>;
  education?: Array<{ school: string; degree?: string; field?: string }>;
  projects?: Array<{ name: string; description: string; technologies?: string[] }>;
}

function contactLine(resume: PrintableResume): string {
  const contact = [resume.email, resume.phone, resume.location].filter(Boolean).map((value) => inlineText(value!));
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
  return (resume.projects ?? []).map((item) => `<article class="project"><h3>${inlineText(item.name)}</h3><p>${inlineText(item.description)}</p>${item.technologies?.length ? `<p class="techline"><span>Built with</span> ${item.technologies.map(inlineText).join(`<span class="tech-dot">·</span>`)}</p>` : ""}</article>`).join("");
}

function renderEducation(resume: PrintableResume): string {
  return (resume.education ?? []).map((item) => `<article class="entry education-entry"><div class="entry-top"><div><h3>${inlineText(item.school)}</h3><p class="entry-company">${inlineText([item.degree, item.field].filter(Boolean).join(" · "))}</p></div></div></article>`).join("");
}

function renderAlignment(resume: PrintableResume): string {
  if (!resume.targetRole && !resume.targetCompany && !resume.postingSignals?.length && !resume.relevantEvidence?.length) return "";
  const target = [resume.targetRole, resume.targetCompany].filter(Boolean).join(" · ");
  const signals = resume.postingSignals?.length ? `<div><h3>What the posting emphasizes</h3>${bulletList(resume.postingSignals, "compact-list")}</div>` : "";
  const evidence = resume.relevantEvidence?.length ? `<div><h3>Evidence from your background</h3><ul class="evidence-list">${resume.relevantEvidence.map((item) => `<li><strong>${inlineText(item.label)}</strong><span>${inlineText(item.text)}</span></li>`).join("")}</ul>${resume.relevantSkills?.length ? `<p class="matched-skills"><span>Matched profile language</span> ${resume.relevantSkills.map(inlineText).join(`<span class="tech-dot">·</span>`)}</p>` : ""}</div>` : "";
  return `<section class="alignment">${sectionHeading("Role alignment", target)}<div class="alignment-grid">${signals}${evidence || `<div><h3>Profile check</h3><p class="alignment-note">No direct profile terms matched this posting. Review the requirements before applying.</p></div>`}</div></section>`;
}

export function resumeToHtml(resume: PrintableResume): string {
  const portfolio = safeUrl(resume.portfolioUrl ?? "");
  const skills = resume.skills?.length ? `<section>${sectionHeading("Skills & technologies")}<div class="skill-list">${resume.skills.map((skill) => `<span>${inlineText(skill)}</span>`).join("")}</div></section>` : "";
  const interests = resume.interests?.length ? `<section>${sectionHeading("Interests")}<p class="interest-line">${resume.interests.map(inlineText).join(`<span class="tech-dot">·</span>`)}</p></section>` : "";
  const summary = resume.summary ? `<section class="summary-section">${sectionHeading("Profile")}<p class="summary">${inlineText(resume.summary)}</p></section>` : "";
  const experience = resume.experience?.length ? `<section>${sectionHeading("Professional experience")}${renderExperience(resume)}</section>` : "";
  const projects = resume.projects?.length ? `<section>${sectionHeading("Selected projects")}${renderProjects(resume)}</section>` : "";
  const education = resume.education?.length ? `<section>${sectionHeading("Education")}${renderEducation(resume)}</section>` : "";
  const contact = contactLine(resume);
  const portfolioNote = portfolio ? `<a class="portfolio-badge" href="${escapeHtml(portfolio)}">Portfolio ↗</a>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${inlineText(resume.name ?? "Resume")}</title><style>
@page{size:Letter;margin:0.48in 0.54in 0.52in}*{box-sizing:border-box}html{background:#e8e4dc}body{margin:0;background:#fff;color:#1c2830;font-family:Arial,Helvetica,sans-serif;font-size:9.25pt;line-height:1.38;-webkit-print-color-adjust:exact;print-color-adjust:exact}a{color:inherit;text-decoration:none}.resume-page{max-width:7.5in;margin:0 auto}.masthead{border-bottom:2px solid #1c2830;padding:0 0 13px;position:relative}.masthead::after{content:"";display:block;width:54px;height:4px;background:#c45536;position:absolute;bottom:-3px;left:0}.name{font-family:Georgia,"Times New Roman",serif;font-size:29pt;line-height:.95;letter-spacing:-.055em;margin:0;color:#15242c}.headline{font-size:11pt;font-weight:700;letter-spacing:.02em;color:#c45536;margin:7px 0 6px}.contact{color:#53636a;font-size:8.1pt;display:flex;flex-wrap:wrap;align-items:center;gap:0}.contact a{color:#1b5d6b;text-decoration:underline;text-underline-offset:2px}.dot{color:#c45536;font-weight:700;padding:0 6px}.portfolio-badge{position:absolute;right:0;top:3px;border:1px solid #1b5d6b;color:#1b5d6b;border-radius:999px;padding:4px 8px;font-size:7.2pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px;border-bottom:1px solid #bac4c5;padding-bottom:4px;margin:17px 0 8px;color:#1b5d6b;font-size:8.2pt;font-weight:700;letter-spacing:.16em;text-transform:uppercase}.section-heading small{font-size:7.4pt;color:#6b777b;font-weight:400;letter-spacing:.02em;text-transform:none;text-align:right}.summary-section{max-width:7.1in}.summary{font-family:Georgia,"Times New Roman",serif;font-size:10.15pt;line-height:1.43;margin:0;color:#334149;white-space:pre-line}.entry,.project{break-inside:avoid;margin:0 0 10px}.entry-top{display:flex;justify-content:space-between;gap:14px;align-items:baseline}.entry h3,.project h3{font-family:Georgia,"Times New Roman",serif;font-size:11.4pt;line-height:1.1;letter-spacing:-.015em;margin:0;color:#162a32}.entry-company{font-weight:700;color:#c45536;margin:2px 0 0;font-size:8.8pt}.entry-dates{font-size:8pt;color:#647277;white-space:nowrap;margin:0}.resume-bullets{margin:4px 0 0;padding-left:17px}.resume-bullets li{margin:2px 0;padding-left:2px}.project{border-left:3px solid #d8dedb;padding:0 0 1px 10px}.project p{margin:4px 0 0;color:#35464c}.techline,.matched-skills,.interest-line{font-size:7.9pt!important;color:#5b6b70!important;line-height:1.45;margin-top:5px!important}.techline span:first-child,.matched-skills span:first-child{font-weight:700;color:#1b5d6b;text-transform:uppercase;letter-spacing:.08em;font-size:7pt;margin-right:4px}.tech-dot{color:#c45536;font-weight:700;padding:0 5px}.alignment{background:#f3f6f3;border:1px solid #d6e0db;border-left:4px solid #c45536;padding:0 12px 9px;margin-top:15px;break-inside:avoid}.alignment .section-heading{margin:10px 0 8px;border-bottom-color:#c8d2cc}.alignment-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.alignment h3{font-size:8.4pt;letter-spacing:.08em;text-transform:uppercase;color:#1b5d6b;margin:0 0 4px}.compact-list{padding-left:15px;margin:0}.compact-list li{margin:2px 0;font-size:8.15pt;line-height:1.3}.evidence-list{list-style:none;padding:0;margin:0}.evidence-list li{margin:0 0 5px;font-size:8.15pt;line-height:1.3}.evidence-list strong{display:block;color:#1d3038;font-size:8pt}.evidence-list span{display:block;color:#405157}.alignment-note{font-size:8.2pt;color:#53636a;margin:0}.skill-list{display:flex;flex-wrap:wrap;gap:5px 7px}.skill-list span{border:1px solid #cad4d2;border-radius:999px;padding:3px 7px;font-size:7.8pt;color:#31464c;background:#f7f9f7}.education-entry{margin-bottom:5px}@media print{html{background:#fff}.resume-page{max-width:none}.alignment{background:#f3f6f3}}
</style></head><body><div class="resume-page"><header class="masthead"><h1 class="name">${inlineText(resume.name ?? "")}</h1>${resume.headline ? `<p class="headline">${inlineText(resume.headline)}</p>` : ""}<p class="contact">${contact}</p>${portfolioNote}</header><main>${summary}${renderAlignment(resume)}${experience}${projects}${education}${skills}${interests}</main></div></body></html>`;
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
          margin: { top: "0.48in", right: "0.54in", bottom: "0.52in", left: "0.54in" },
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
