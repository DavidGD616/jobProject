import { createHash } from "node:crypto";

import { z } from "zod";

import type { CareerPageSelectors } from "@/db/schema";
import type { NormalizedPosting } from "./_contract";

export interface CareerPagePosting {
  sourceId: string;
  url: string;
  title: string;
  location: string | null;
  description: string;
}

const SIMPLE_SELECTOR = /^([a-z][a-z0-9-]*)(?:\.([A-Za-z0-9_-]+))?$/;
const MAX_SELECTOR_LENGTH = 120;
const MAX_GENERATION_DOM_CHARS = 60_000;
const OMITTED_DOM_ELEMENTS = /<(?:script|style|template|noscript|svg|canvas|iframe|object|embed)\b[^>]*>[\s\S]*?(?:<\/(?:script|style|template|noscript|svg|canvas|iframe|object|embed)\s*>|$)/gi;
const HTML_TAG = /<\/?([a-z][a-z0-9:-]*)\b[^>]*>/gi;
const OPENING_HTML_TAG = /<([a-z][a-z0-9:-]*)\b[^>]*>/gi;

/**
 * Career-page extraction deliberately supports only a tag and optional single
 * class token. The replay parser below implements precisely this grammar; it
 * is not a general-purpose CSS selector engine.
 */
export function isSupportedCareerPageSelector(selector: string): boolean {
  return SIMPLE_SELECTOR.test(selector);
}

const careerPageSelectorSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SELECTOR_LENGTH)
  .refine(isSupportedCareerPageSelector, {
    message: "must be a lowercase HTML tag optionally followed by one .class token",
  });

/** Validate the small, deterministic selector language used by the replayer. */
export const careerPageSelectorsSchema = z
  .object({
    item: careerPageSelectorSchema,
    title: careerPageSelectorSchema,
    url: careerPageSelectorSchema,
    location: careerPageSelectorSchema.optional(),
    description: careerPageSelectorSchema.optional(),
  })
  .strict();

export function parseCareerPageSelectors(value: unknown): CareerPageSelectors {
  return careerPageSelectorsSchema.parse(value);
}

function textOf(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function selectorParts(selector: string): { tag: string; className?: string } {
  const match = selector.match(SIMPLE_SELECTOR);
  if (!match) throw new Error(`Unsupported career selector: ${selector}`);
  return { tag: match[1]!, className: match[2] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classLookahead(className: string | undefined): string {
  if (!className) return "";
  const escaped = escapeRegExp(className);
  // Match complete whitespace-delimited class tokens, including when the
  // token is the first or last value in the class attribute.
  return `(?=[^>]*\\sclass\\s*=\\s*["'](?:[^"']*\\s)?${escaped}(?=\\s|["']))`;
}

function matchingElement(block: string, selector: string): string | null {
  const parts = selectorParts(selector);
  const expression = new RegExp(
    `<${escapeRegExp(parts.tag)}\\b${classLookahead(parts.className)}[^>]*>[\\s\\S]*?<\\/${escapeRegExp(parts.tag)}\\s*>`,
    "i",
  );
  return block.match(expression)?.[0] ?? null;
}

function blocksFor(html: string, selector: string): string[] {
  const parts = selectorParts(selector);
  const pattern = new RegExp(
    `<${escapeRegExp(parts.tag)}\\b${classLookahead(parts.className)}[^>]*>[\\s\\S]*?<\\/${escapeRegExp(parts.tag)}\\s*>`,
    "gi",
  );
  return [...html.matchAll(pattern)].map((match) => match[0]);
}

function fieldText(block: string, selector: string | undefined): string | null {
  if (!selector) return null;
  const element = matchingElement(block, selector);
  return element ? textOf(element) : null;
}

function linkFrom(block: string, selector: string): string | null {
  const element = matchingElement(block, selector);
  if (!element) return null;
  return attributeValue(element, "href");
}

function stripOmittedDomElements(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(OMITTED_DOM_ELEMENTS, "");
}

function attributeValue(tag: string, name: "class" | "href"): string | null {
  const expression = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(expression);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizedOpeningTag(rawTag: string, tagName: string): string {
  const classValue = attributeValue(rawTag, "class");
  const classes = classValue
    ?.split(/\s+/)
    .filter((value) => /^[A-Za-z0-9_-]+$/.test(value))
    .slice(0, 12) ?? [];
  const href = attributeValue(rawTag, "href");
  const safeHref = href && !/^(?:javascript|data|vbscript):/i.test(href.trim())
    ? href.trim().slice(0, 2_048)
    : null;
  return `<${tagName}${classes.length > 0 ? ` class="${escapeHtmlAttribute(classes.join(" "))}"` : ""}${safeHref ? ` href="${escapeHtmlAttribute(safeHref)}"` : ""}>`;
}

/**
 * Keep only inert, selector-relevant DOM structure for the one-time rule
 * generator. No scripts, styles, event handlers, or arbitrary attributes are
 * sent to a CLI, and the payload is capped below every installed provider's
 * prompt limit.
 */
export function sanitizeCareerPageDom(html: string): string {
  const sanitized = stripOmittedDomElements(html)
    .replace(HTML_TAG, (rawTag, rawTagName: string) => {
      const tagName = rawTagName.toLowerCase();
      return rawTag.startsWith("</")
        ? `</${tagName}>`
        : sanitizedOpeningTag(rawTag, tagName);
    })
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= MAX_GENERATION_DOM_CHARS) return sanitized;

  const headLength = Math.floor(MAX_GENERATION_DOM_CHARS * 0.6);
  const tailLength = MAX_GENERATION_DOM_CHARS - headLength;
  return `${sanitized.slice(0, headLength)} <!-- DOM truncated for bounded selector generation --> ${sanitized.slice(-tailLength)}`;
}

/**
 * Hash a stable vocabulary of element/class shapes instead of page text or
 * repeated job rows. That catches a layout redesign without regenerating a
 * rule merely because titles, links, or listing counts changed.
 */
export function fingerprintCareerPageDom(html: string): string {
  const shapes = new Set<string>();
  for (const match of stripOmittedDomElements(html).matchAll(OPENING_HTML_TAG)) {
    const tagName = match[1]?.toLowerCase();
    if (!tagName) continue;
    const rawTag = match[0];
    const classes = attributeValue(rawTag, "class")
      ?.split(/\s+/)
      .filter((value) => /^[A-Za-z0-9_-]+$/.test(value))
      .sort()
      .join(".") ?? "";
    shapes.add(`${tagName}${classes ? `.${classes}` : ""}${attributeValue(rawTag, "href") ? "[href]" : ""}`);
  }
  return createHash("sha256").update([...shapes].sort().join("\n")).digest("hex");
}

/** Parse simple generated selectors from a rendered career page snapshot. */
export function extractCareerPagePostings(html: string, selectors: CareerPageSelectors, baseUrl: string): CareerPagePosting[] {
  const parsedSelectors = parseCareerPageSelectors(selectors);
  return blocksFor(html, parsedSelectors.item).flatMap((block) => {
    const title = fieldText(block, parsedSelectors.title);
    const href = linkFrom(block, parsedSelectors.url);
    if (!title || !href) return [];
    let url: URL;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return [];
    }
    if (!/^https?:$/.test(url.protocol)) return [];
    const description = fieldText(block, parsedSelectors.description) ?? title;
    return [{ sourceId: createHash("sha256").update(url.toString()).digest("hex").slice(0, 24), url: url.toString(), title, location: fieldText(block, parsedSelectors.location), description }];
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
