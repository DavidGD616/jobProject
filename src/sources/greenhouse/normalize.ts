import type { NormalizedPosting } from "@/sources";

import { htmlToText, normalizeTitle } from "../normalize";
import type { GreenhouseJob } from "./schema";

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export function normalize(
  raw: Readonly<GreenhouseJob>,
): NormalizedPosting {
  return {
    url: raw.absolute_url,
    title: raw.title.trim(),
    titleNorm: normalizeTitle(raw.title),
    description: htmlToText(raw.content ?? ""),
    location: raw.location?.name.trim() || null,
    postedAt: parseDate(raw.first_published),
  };
}

export function sourceId(raw: Readonly<GreenhouseJob>): string {
  return String(raw.id);
}
