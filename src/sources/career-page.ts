import { createHash } from "node:crypto";

import type { CareerPageSelectors } from "@/db";
import type { NormalizedPosting } from "./_contract";

export interface CareerPagePosting {
  sourceId: string;
  url: string;
  title: string;
  location: string | null;
  description: string;
}

function textOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function selectorParts(selector: string): { tag: string; className?: string } {
  const match = selector.trim().match(/^([a-z0-9]+)?(?:\.([a-z0-9_-]+))?$/i);
  if (!match) throw new Error(`Unsupported career selector: ${selector}`);
  return { tag: match[1] ?? "div", className: match[2] };
}

function blocksFor(html: string, selector: string): string[] {
  const parts = selectorParts(selector);
  const classExpression = parts.className ? `(?=[^>]*class=["'][^"']*\\b${parts.className}\\b)` : "";
  const pattern = new RegExp(`<${parts.tag}\\b${classExpression}[^>]*>[\\s\\S]*?<\\/${parts.tag}>`, "gi");
  return [...html.matchAll(pattern)].map((match) => match[0]);
}

function fieldText(block: string, selector: string | undefined): string | null {
  if (!selector) return null;
  const parts = selectorParts(selector);
  const match = block.match(new RegExp(`<${parts.tag}\\b[^>]*>[\\s\\S]*?<\\/${parts.tag}>`, "i"));
  return match ? textOf(match[0]) : null;
}

function linkFrom(block: string, selector: string): string | null {
  const parts = selectorParts(selector);
  const pattern = new RegExp(`<${parts.tag}\\b[^>]*href=["']([^"']+)["'][^>]*>[\\s\\S]*?<\\/${parts.tag}>`, "i");
  return block.match(pattern)?.[1] ?? null;
}

/** Parse simple generated selectors from a rendered career page snapshot. */
export function extractCareerPagePostings(html: string, selectors: CareerPageSelectors, baseUrl: string): CareerPagePosting[] {
  return blocksFor(html, selectors.item).flatMap((block) => {
    const title = fieldText(block, selectors.title);
    const href = linkFrom(block, selectors.url);
    if (!title || !href) return [];
    const url = new URL(href, baseUrl).toString();
    const description = fieldText(block, selectors.description) ?? title;
    return [{ sourceId: createHash("sha256").update(url).digest("hex").slice(0, 24), url, title, location: fieldText(block, selectors.location), description }];
  });
}

export interface CareerPageBrowser {
  goto(url: string): Promise<void>;
  content(): Promise<string>;
}

export async function renderCareerPage(browser: CareerPageBrowser, url: string): Promise<string> {
  await browser.goto(url);
  return browser.content();
}

export function normalizeCareerPagePosting(posting: CareerPagePosting): NormalizedPosting {
  return {
    url: posting.url,
    title: posting.title,
    titleNorm: posting.title.toLowerCase().replace(/\s+/g, " ").trim(),
    description: posting.description,
    location: posting.location,
    remoteType: null,
    postedAt: null,
  };
}
