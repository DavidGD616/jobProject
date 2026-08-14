import { decodeHTML } from "entities";

export type RemoteType = "onsite" | "hybrid" | "remote" | "unknown";

/**
 * Turn the HTML/entity-encoded descriptions returned by ATS APIs into the
 * plain text stored in jobs.description. This intentionally preserves line
 * breaks at block boundaries while dropping markup and script/style content.
 */
export function htmlToText(input: string): string {
  return decodeHTML(input)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(
      /<\/(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)>/gi,
      "\n",
    )
    .replace(/<[^>]*>/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Location is source-owned metadata. Preserve an explicit Remote/Hybrid/
 * On-site signal here so the stage-one filters do not have to rediscover it
 * from the description.
 */
export function normalizeRemoteType(
  location: string | null | undefined,
): RemoteType {
  const value = location?.trim().toLowerCase();
  if (!value) return "unknown";
  if (/\bhybrid\b/.test(value)) return "hybrid";
  if (/\bremote\b/.test(value)) return "remote";
  if (/\b(?:on[- ]?site|in[- ]?office)\b/.test(value)) return "onsite";
  return "unknown";
}

/**
 * Normalize only title noise that is common across ATS boards. The original
 * title remains available for display; this value is used for dedup/search.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKC")
    .replace(/\s*\([^)]*(?:m\/f\/d|f\/m\/d|all genders)[^)]*\)\s*$/i, "")
    .replace(/\s*\[[^\]]+\]\s*$/i, "")
    .replace(
      /\s*[-–—]\s*(?:fully\s+)?(?:remote|hybrid|on[- ]?site)(?:\s*[-–—].*)?$/i,
      "",
    )
    .replace(
      /^\s*(?:senior|sr\.?|staff|principal|lead|junior|jr\.?)\s+/i,
      "",
    )
    .replace(
      /\s+(?:req(?:uisition)?|job)\s*(?:id|#)?\s*[:#-]?\s*[a-z0-9-]+\s*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
