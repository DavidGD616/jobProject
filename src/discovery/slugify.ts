const legalSuffixes = new Set([
  "co",
  "company",
  "corp",
  "corporation",
  "gmbh",
  "inc",
  "incorporated",
  "limited",
  "llc",
  "ltd",
  "plc",
  "sa",
  "sl",
]);

function tokens(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function trailingLegalSuffixLength(value: readonly string[]): number {
  // Punctuation-separated abbreviations (for example, `S.L.` and `L.L.C.`)
  // are tokenized as individual letters. Join up to three trailing tokens so
  // the same legal-suffix rule handles both abbreviated and plain forms.
  for (let length = Math.min(3, value.length); length > 0; length -= 1) {
    if (legalSuffixes.has(value.slice(-length).join(""))) return length;
  }
  return 0;
}

function stripTrailingLegalSuffixes(value: readonly string[]): string[] {
  let current = [...value];
  while (current.length > 0) {
    const suffixLength = trailingLegalSuffixLength(current);
    if (suffixLength === 0) break;
    current = current.slice(0, -suffixLength);
  }
  return current;
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generate the compact, hyphenated, and legal-suffix-stripped forms used by
 * the public ATS board tokens. The order favors the common forms first.
 */
export function slugVariants(value: string): string[] {
  const rawTokens = tokens(value);
  const tokenSets: string[][] = [];
  let current = rawTokens;
  while (current.length > 0) {
    tokenSets.push(current);
    const suffixLength = trailingLegalSuffixLength(current);
    if (suffixLength === 0) break;
    current = current.slice(0, -suffixLength);
  }

  const candidates = tokenSets.flatMap((tokenSet) => [
    tokenSet.join(""),
    tokenSet.join("-"),
  ]);

  const variants: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeToken(candidate);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      variants.push(normalized);
    }
  }
  return variants;
}

/**
 * Stable company identity for storage and deduplication. ATS board tokens are
 * intentionally kept separate because their namespaces differ by provider.
 */
export function companySlug(value: string): string {
  return normalizeToken(stripTrailingLegalSuffixes(tokens(value)).join("-"));
}
