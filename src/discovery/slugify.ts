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
    const last = current.at(-1);
    if (!last || !legalSuffixes.has(last)) break;
    current = current.slice(0, -1);
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
