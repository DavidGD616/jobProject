import type { CandidateCompany, DiscoveryAtsType } from "./_contract";

const atsPatterns: Array<{ type: DiscoveryAtsType; pattern: RegExp }> = [
  { type: "greenhouse", pattern: /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)/gi },
  { type: "lever", pattern: /https?:\/\/jobs\.lever\.co\/([a-z0-9_-]+)/gi },
  { type: "ashby", pattern: /https?:\/\/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/gi },
];

function humanizeToken(token: string): string {
  return token.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()).trim();
}

/** Pull verified-ATS candidates out of aggregator/application URLs. */
export function extractReverseAtsCandidates(input: string, discoveredVia = "reverse_url"): CandidateCompany[] {
  const output: CandidateCompany[] = [];
  const seen = new Set<string>();
  for (const item of atsPatterns) {
    for (const match of input.matchAll(item.pattern)) {
      const token = match[1]?.trim().toLowerCase();
      if (!token) continue;
      const key = `${item.type}:${token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      output.push({ name: humanizeToken(token), slugHint: token, atsType: item.type, atsToken: token, discoveredVia });
    }
  }
  return output;
}
