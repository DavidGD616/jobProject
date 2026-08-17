const STOP_WORDS = new Set([
  "and", "the", "with", "for", "from", "that", "this", "your", "you", "our",
  "are", "will", "have", "has", "not", "but", "job", "role", "team", "work",
  "years", "year", "into", "who", "about", "their", "they", "all", "any",
]);

export function tokenize(input: string): string[] {
  return input
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[-./]+|[-./]+$/g, ""))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

/** Remove common benefit/EEO boilerplate before lexical retrieval. */
export function stripBoilerplate(input: string): string {
  const chunks = input.split(/\n{2,}/).filter((chunk) => {
    return !/(equal opportunity|benefits package|what we offer|perks and benefits|privacy notice|accommodations statement)/i.test(chunk);
  });
  return chunks.join("\n\n").trim().slice(0, 80_000);
}

export function profileTerms(input: {
  skills: readonly string[];
  titleAliases: readonly string[];
  skillAliases: Record<string, string[]>;
  queryTerms: Record<string, number>;
}): Array<{ term: string; weight: number }> {
  const weights = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const normalized = term.trim().toLowerCase();
    if (!normalized) return;
    weights.set(normalized, Math.max(weights.get(normalized) ?? 0, weight));
  };
  input.skills.forEach((term) => add(term, 2));
  input.titleAliases.forEach((term) => add(term, 2));
  Object.entries(input.skillAliases).forEach(([term, aliases]) => {
    add(term, 2);
    aliases.forEach((alias) => add(alias, 1));
  });
  Object.entries(input.queryTerms).forEach(([term, weight]) => add(term, weight));
  return [...weights.entries()].map(([term, weight]) => ({ term, weight }));
}

function includesTerm(haystack: string, term: string): boolean {
  return tokenize(term).every((token) => haystack.includes(token));
}

export function lexicalScore(input: {
  title: string;
  description: string;
  stack: string[] | null;
  terms: Array<{ term: string; weight: number }>;
}): number {
  if (input.terms.length === 0) return 0;
  const title = input.title.toLowerCase();
  const body = `${input.description}\n${input.stack?.join(" ") ?? ""}`.toLowerCase();
  let earned = 0;
  let possible = 0;
  for (const item of input.terms) {
    possible += item.weight;
    if (includesTerm(title, item.term)) earned += item.weight * 1.8;
    else if (includesTerm(body, item.term)) earned += item.weight;
  }
  return Math.max(0, Math.min(1, earned / Math.max(1, possible * 1.8)));
}
