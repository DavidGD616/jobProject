import type {
  Profile,
  ResumeProfileJson,
  TailorFitAssessment,
  TailoringEvidence,
} from "@/db/schema";

/** Bump whenever the structured tailoring contract or factual rules change. */
export const TAILOR_PROMPT_VERSION = "tailor-v7";

type RequirementKind = "skill" | "clearance" | "citizenship" | "years" | "seniority" | "role";

export interface TailoringRequirement {
  label: string;
  kind: RequirementKind;
  tokens: string[];
  required: boolean;
}

export interface TailorSelections {
  projectIndices: Set<number>;
  projectBulletIndices: Map<number, Set<number>>;
  experienceBulletIndices: Map<number, Set<number>>;
  skills: Set<string>;
}

export interface SerializableTailorSelections {
  projectIndices?: readonly number[];
  projectBullets?: ReadonlyArray<{
    projectIndex: number;
    bulletIndices: readonly number[];
  }>;
  experienceBullets?: ReadonlyArray<{
    experienceIndex: number;
    bulletIndices: readonly number[];
  }>;
  skills?: readonly string[];
}

export interface GroundedTailoringPlan {
  requirements: TailoringRequirement[];
  selections: TailorSelections;
  skillScores: Map<string, number>;
  projectScores: number[];
  /** User-designated projects that must survive relevance pruning. */
  featuredProjectIndices: number[];
  /** Transferable (not technical) project facts available for safe fallback. */
  projectTransferableScores: number[];
  projectBulletScores: number[][];
  experienceBulletScores: number[][];
  /** Transferable (not technical) source facts used only to prioritize bullets. */
  experienceTransferableScores: number[][];
  /** Job-aligned transferable facts eligible for a cover-letter fallback. */
  experienceJobTransferableScores: number[][];
  evidenceMap: TailoringEvidence[];
  fitAssessment: TailorFitAssessment;
}

interface NamedRequirement {
  label: string;
  patterns: RegExp[];
}

const ignoredTerms = new Set([
  "about", "after", "also", "among", "and", "are", "been", "being", "but", "can", "company", "for", "from", "have", "into", "its", "more", "our", "role", "that", "the", "their", "this", "through", "with", "will", "you", "your",
  "ability", "across", "build", "building", "candidate", "candidates", "collaborate", "collaboration", "deliver", "development", "engineer", "engineering", "experience", "including", "looking", "member", "must", "needs", "people", "preferred", "requirements", "responsibilities", "software", "team", "teams", "technical", "work", "working", "years",
]);

const genericTitleTerms = new Set([
  "associate", "developer", "engineer", "full", "junior", "lead", "level", "mid", "principal", "senior", "software", "staff", "stack",
]);

const skillDisplayTokens: Record<string, string> = {
  ai: "AI",
  api: "API",
  aws: "AWS",
  css: "CSS",
  gcp: "GCP",
  graphql: "GraphQL",
  html5: "HTML5",
  llm: "LLM",
  mongodb: "MongoDB",
  mysql: "MySQL",
  nextjs: "Next.js",
  nodejs: "Node.js",
  openai: "OpenAI",
  postgresql: "PostgreSQL",
  rest: "REST",
  sql: "SQL",
  supabase: "Supabase",
  typescript: "TypeScript",
  ui: "UI",
  ux: "UX",
};

const namedRequirements: NamedRequirement[] = [
  { label: "TypeScript", patterns: [/\btype\s*script\b/i] },
  { label: "JavaScript", patterns: [/\bjava\s*script\b/i] },
  { label: "React", patterns: [/\breact(?:\.js)?\b/i] },
  { label: "Next.js", patterns: [/\bnext\s*\.?\s*js\b/i] },
  { label: "Node.js", patterns: [/\bnode\s*\.?\s*js\b/i] },
  { label: "Ruby", patterns: [/\bruby\b/i] },
  { label: "Rails", patterns: [/\bruby\s+on\s+rails\b/i, /\brails\b/i] },
  { label: "Python", patterns: [/\bpython\b/i] },
  { label: "Java", patterns: [/\bjava\b/i] },
  { label: "C#", patterns: [/\bc#\b/i, /\bcsharp\b/i] },
  { label: ".NET", patterns: [/\b\.net\b/i, /\bdotnet\b/i] },
  { label: "SQL", patterns: [/\bsql\b/i] },
  { label: "PostgreSQL", patterns: [/\bpostgres(?:ql)?\b/i] },
  { label: "MySQL", patterns: [/\bmysql\b/i] },
  { label: "MongoDB", patterns: [/\bmongo(?:db)?\b/i] },
  { label: "Supabase", patterns: [/\bsupabase\b/i] },
  { label: "GraphQL", patterns: [/\bgraphql\b/i] },
  { label: "REST", patterns: [/\brest(?:ful)?\b/i, /\brest\s+api/i] },
  { label: "AWS", patterns: [/\baws\b/i, /\bamazon\s+web\s+services\b/i] },
  { label: "GCP", patterns: [/\bgcp\b/i, /\bgoogle\s+cloud\b/i] },
  { label: "Azure", patterns: [/\bazure\b/i] },
  { label: "Docker", patterns: [/\bdocker\b/i] },
  { label: "Kubernetes", patterns: [/\bkubernetes\b/i, /\bk8s\b/i] },
  { label: "Terraform", patterns: [/\bterraform\b/i] },
  { label: "Flutter", patterns: [/\bflutter\b/i] },
  { label: "Dart", patterns: [/\bdart\b/i] },
  { label: "Swift", patterns: [/\bswift\b/i] },
  { label: "Kotlin", patterns: [/\bkotlin\b/i] },
  { label: "Tailwind", patterns: [/\btailwind(?:css)?\b/i] },
  { label: "Playwright", patterns: [/\bplaywright\b/i] },
  { label: "Jest", patterns: [/\bjest\b/i] },
  { label: "Cypress", patterns: [/\bcypress\b/i] },
];

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .replace(/next\s*\.?\s*js/g, "nextjs")
    .replace(/node\s*\.?\s*js/g, "nodejs")
    .replace(/react\s*\.?\s*js/g, "react")
    .replace(/type\s*script/g, "typescript")
    .replace(/java\s*script/g, "javascript")
    .replace(/postgre\s*sql/g, "postgresql")
    .replace(/c#/g, "csharp")
    .replace(/\.net/g, "dotnet")
    // Treat hyphenated role words as the same factual terms as their spaced
    // equivalents (for example Full-Stack and Full Stack).
    .replace(/-/g, " ")
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .trim();
}

function terms(value: string): string[] {
  return [...new Set(normalizedText(value).split(/\s+/).filter((term) => term.length > 2 && !ignoredTerms.has(term)))];
}

function isOptionalMention(text: string, matchIndex: number): boolean {
  const nearby = text.slice(Math.max(0, matchIndex - 100), matchIndex + 100);
  return /\b(?:nice\s+to\s+have|bonus|preferred|plus|desirable|optional)\b/i.test(nearby);
}

function requirementMatchesText(requirement: TailoringRequirement, text: string): boolean {
  const normalized = normalizedText(text);
  if (requirement.kind === "skill") {
    const known = namedRequirements.find((candidate) => candidate.label === requirement.label);
    return known?.patterns.some((pattern) => pattern.test(text)) ?? false;
  }
  if (requirement.kind === "clearance") return /\b(?:top\s+secret|secret|security|ts\/sci)\b.*\bclearance\b|\bclearance\b/i.test(text);
  if (requirement.kind === "citizenship") return /\b(?:u\.?s\.?|united\s+states)\s+citizen(?:ship)?\b/i.test(text);
  if (requirement.kind === "years" || requirement.kind === "seniority") return false;
  const candidateTerms = terms(normalized);
  const requiredTerms = requirement.tokens.filter((term) => !genericTitleTerms.has(term));
  const comparisonTerms = requiredTerms.length > 0 ? requiredTerms : requirement.tokens;
  const needed = comparisonTerms.length >= 3 ? 2 : 1;
  return comparisonTerms.filter((term) => candidateTerms.includes(term)).length >= needed;
}

function scoreText(text: string, jobTerms: readonly string[], requirements: readonly TailoringRequirement[]): number {
  const candidate = new Set(terms(text));
  let score = jobTerms.filter((term) => candidate.has(term)).length;
  for (const requirement of requirements) {
    if (requirement.kind === "skill" && requirementMatchesText(requirement, text)) score += 8;
    if (requirement.kind === "role" && requirementMatchesText(requirement, text)) score += 3;
  }
  return score;
}

function canonicalSkills(profile: Profile): string[] {
  const candidates = profile.skills.length > 0 ? profile.skills : profile.resumeJson.skills ?? [];
  const seen = new Set<string>();
  return candidates.filter((skill) => {
    const key = normalizedText(skill);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Style saved skill terms for a reader without changing their factual meaning. */
function displaySkill(skill: string): string {
  return normalizedText(skill)
    .split(" ")
    .filter(Boolean)
    .map((token) => skillDisplayTokens[token] ?? `${token[0]!.toUpperCase()}${token.slice(1)}`)
    .join(" ");
}

function cloneSelections(selections: TailorSelections): TailorSelections {
  return {
    projectIndices: new Set(selections.projectIndices),
    projectBulletIndices: new Map([...selections.projectBulletIndices].map(([index, values]) => [index, new Set(values)])),
    experienceBulletIndices: new Map([...selections.experienceBulletIndices].map(([index, values]) => [index, new Set(values)])),
    skills: new Set(selections.skills),
  };
}

function addIndices(target: Map<number, Set<number>>, sourceIndex: number, indices: readonly number[]): void {
  const selected = target.get(sourceIndex) ?? new Set<number>();
  for (const index of indices) selected.add(index);
  if (selected.size > 0) target.set(sourceIndex, selected);
}

function descendingByScore(indices: Iterable<number>, scoreAt: (index: number) => number): number[] {
  return [...indices].sort((left, right) => scoreAt(right) - scoreAt(left) || left - right);
}

function selectedIndicesForScores(scores: readonly number[], limit: number): number[] {
  const ranked = scores.map((score, index) => ({ index, score })).sort((left, right) => right.score - left.score || left.index - right.index);
  const relevant = ranked.filter((item) => item.score > 0);
  if (relevant.length === 0) return ranked.slice(0, limit).map((item) => item.index);

  // When there is clearly strong project evidence, do not dilute it with a
  // project that matched only one incidental word. Comparable projects still
  // remain available, so this can select two or three rather than just one.
  const strongest = relevant[0]!.score;
  const minimumScore = strongest >= 8 ? Math.ceil(strongest * 0.4) : 1;
  return relevant.filter((item) => item.score >= minimumScore).slice(0, limit).map((item) => item.index);
}

function featuredProjectIndices(resume: ResumeProfileJson): number[] {
  return (resume.projects ?? []).flatMap((project, index) => project.featured ? [index] : []);
}

/**
 * A featured project is a user-authored presentation choice, so it is never
 * dropped just because a lexical relevance threshold favored another project.
 */
function selectedProjectIndices(
  scores: readonly number[],
  featuredIndices: readonly number[],
  limit: number,
): number[] {
  const featured = [...new Set(featuredIndices)].filter((index) => index >= 0 && index < scores.length);
  const featuredSet = new Set(featured);
  const resultLimit = Math.max(limit, featured.length);
  return [
    ...featured,
    ...selectedIndicesForScores(scores, resultLimit).filter((index) => !featuredSet.has(index)),
  ].slice(0, resultLimit);
}

function orderedProjectIndices(
  indices: Iterable<number>,
  scores: readonly number[],
  featuredIndices: readonly number[],
): number[] {
  const featured = new Set(featuredIndices);
  return [...indices].sort((left, right) => {
    const featuredDifference = Number(featured.has(right)) - Number(featured.has(left));
    return featuredDifference || scores[right]! - scores[left]! || left - right;
  });
}

function relevantIndicesForScores(scores: readonly number[], limit: number): number[] {
  return scores
    .map((score, index) => ({ index, score }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((item) => item.index);
}

/** A generic lexical overlap is not enough to market a past bullet as role evidence. */
function hasSpecificRoleOrSkillEvidence(text: string, requirements: readonly TailoringRequirement[]): boolean {
  return requirements.some((requirement) =>
    (requirement.kind === "skill" || requirement.kind === "role")
    && requirementMatchesText(requirement, text));
}

const transferableExperienceSignals = [
  { pattern: /\b(?:customers?|clients?|users?|stakeholders?|partner\w*)\b/i, weight: 3 },
  { pattern: /\b(?:requirements?|feedback|research|briefs?|needs?)\b/i, weight: 3 },
  { pattern: /\b(?:design(?:s|ed|ing)?|prototypes?|workflows?|interfaces?|journeys?|ux|ui)\b/i, weight: 2 },
  { pattern: /\b(?:collaborat\w*|cross[ -]?functional|coordinat\w*)\b/i, weight: 3 },
  { pattern: /\b(?:quality|test(?:s|ed|ing)?|reviews?|process(?:es)?|production|launch(?:es|ed|ing)?|deliver\w*)\b/i, weight: 1 },
];

/**
 * Transferable facts are never used to assert a technical requirement. They
 * rise above unrelated facts in a resume. Direct technical evidence always
 * remains first; this gives client, requirements, and collaboration facts a
 * truthful second tier even when a job description uses different wording.
 */
function transferablePriorityScore(text: string): number {
  return transferableExperienceSignals.reduce((score, signal) => (
    signal.pattern.test(text) ? score + signal.weight : score
  ), 0);
}

/**
 * Cover-letter fallback facts need an additional connection to the role. A
 * generally transferable source fact can improve resume order without being
 * presented as evidence for an unrelated job requirement.
 */
function jobAlignedTransferableScore(
  text: string,
  jobTerms: readonly string[],
  requirements: readonly TailoringRequirement[],
): number {
  const jobText = [
    ...jobTerms,
    ...requirements.flatMap((requirement) => requirement.tokens),
  ].join(" ");
  return transferableExperienceSignals.reduce((score, signal) => (
    signal.pattern.test(text) && signal.pattern.test(jobText) ? score + signal.weight : score
  ), 0);
}

function sourceText(profile: Profile): string {
  const resume = profile.resumeJson;
  return [
    resume.headline,
    resume.summary,
    ...profile.titleAliases,
    ...canonicalSkills(profile),
    ...(resume.experience ?? []).flatMap((item) => [item.company, item.title, ...item.bullets]),
    ...(resume.projects ?? []).flatMap((item) => [item.name, item.description, ...(item.technologies ?? []), ...(item.bullets ?? [])]),
  ].filter(Boolean).join("\n");
}

function yearsDocumented(resume: ResumeProfileJson): number | null {
  const years = (resume.experience ?? [])
    .flatMap((item) => [item.startDate, item.endDate])
    .flatMap((value) => value?.match(/\b(?:19|20)\d{2}\b/g) ?? [])
    .map(Number)
    .filter(Number.isFinite);
  if (years.length < 2) return null;
  const earliest = Math.min(...years);
  const latest = Math.max(...years.map((year) => Math.min(year, new Date().getFullYear())));
  return Math.max(0, latest - earliest);
}

function titleHasComparableSeniority(profile: Profile, jobTitle: string): boolean {
  const target = jobTitle.toLowerCase();
  const targetLevel = /\b(?:senior|staff|principal|lead|manager|director)\b/.exec(target)?.[0];
  if (!targetLevel) return true;
  const facts = [
    profile.resumeJson.headline,
    ...profile.titleAliases,
    ...(profile.resumeJson.experience ?? []).map((item) => item.title),
  ].filter(Boolean).join(" ").toLowerCase();
  return new RegExp(`\\b${targetLevel}\\b`, "i").test(facts);
}

/** Extract concrete job requirements without treating every JD word as a skill. */
export function requirementsForJob(jobTitle: string, description: string): TailoringRequirement[] {
  const fullText = `${jobTitle}\n${description}`;
  const requirements: TailoringRequirement[] = [];
  for (const known of namedRequirements) {
    const match = known.patterns.map((pattern) => pattern.exec(fullText)).find(Boolean);
    if (!match) continue;
    requirements.push({
      label: known.label,
      kind: "skill",
      tokens: terms(known.label),
      required: !isOptionalMention(fullText, match.index),
    });
  }

  const clearance = /\b(?:active\s+)?(?:(?:top\s+)?secret|security|ts\/sci)\s+clearance\b|\bclearance\s+(?:required|eligible)\b/i.exec(fullText);
  if (clearance) {
    const label = /top\s+secret/i.test(clearance[0]) ? "Top Secret clearance" : /secret/i.test(clearance[0]) ? "Secret clearance" : "Security clearance";
    requirements.push({ label, kind: "clearance", tokens: ["clearance"], required: true });
  }
  if (/\b(?:u\.?s\.?|united\s+states)\s+citizen(?:ship)?\b/i.test(fullText)) {
    requirements.push({ label: "U.S. citizenship", kind: "citizenship", tokens: ["citizenship"], required: true });
  }
  const yearsMatch = /\b(?:at\s+least|minimum\s+of|over|more\s+than)?\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)(?:\s+of)?\s+(?:professional\s+)?experience\b/i.exec(fullText);
  if (yearsMatch && Number(yearsMatch[1]) >= 3) {
    requirements.push({
      label: `${yearsMatch[1]}+ years of experience`,
      kind: "years",
      tokens: ["experience"],
      required: true,
    });
  }
  if (/\b(?:senior|staff|principal|lead|manager|director)\b/i.test(jobTitle)) {
    requirements.push({ label: "Senior-level scope", kind: "seniority", tokens: terms(jobTitle), required: true });
  }

  const roleTokens = terms(jobTitle);
  if (roleTokens.length > 0) {
    requirements.push({ label: jobTitle, kind: "role", tokens: roleTokens, required: true });
  }
  return requirements;
}

function rankSelections(
  profile: Profile,
  description: string,
  requirements: readonly TailoringRequirement[],
): Pick<GroundedTailoringPlan, "skillScores" | "projectScores" | "featuredProjectIndices" | "projectTransferableScores" | "projectBulletScores" | "experienceBulletScores" | "experienceTransferableScores" | "experienceJobTransferableScores" | "selections"> {
  const jobTerms = terms(description);
  const resume = profile.resumeJson;
  const skills = canonicalSkills(profile);
  const skillScores = new Map(skills.map((skill) => [skill, scoreText(skill, jobTerms, requirements)]));
  const projectScores = (resume.projects ?? []).map((project) => scoreText([project.name, project.description, ...(project.technologies ?? []), ...(project.bullets ?? [])].join(" "), jobTerms, requirements));
  const featuredIndices = featuredProjectIndices(resume);
  const projectTransferableScores = (resume.projects ?? []).map((project) => jobAlignedTransferableScore(
    [project.name, project.description, ...(project.technologies ?? []), ...(project.bullets ?? [])].join(" "),
    jobTerms,
    requirements,
  ));
  const projectBulletScores = (resume.projects ?? []).map((project) => (project.bullets ?? []).map((bullet) => scoreText(bullet, jobTerms, requirements)));
  const experienceBulletScores = (resume.experience ?? []).map((item) => item.bullets.map((bullet) => scoreText(bullet, jobTerms, requirements)));
  const experienceTransferableScores = (resume.experience ?? []).map((item) => item.bullets.map(transferablePriorityScore));
  const experienceJobTransferableScores = (resume.experience ?? []).map((item) => item.bullets.map((bullet) => jobAlignedTransferableScore(bullet, jobTerms, requirements)));

  const selections: TailorSelections = {
    projectIndices: new Set(selectedProjectIndices(projectScores, featuredIndices, 3)),
    projectBulletIndices: new Map(),
    experienceBulletIndices: new Map(),
    skills: new Set(skills
      .map((skill, index) => ({ skill, index, score: skillScores.get(skill) ?? 0 }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 15)
      .map((item) => item.skill)),
  };
  for (const [projectIndex, scores] of projectBulletScores.entries()) {
    const chosen = relevantIndicesForScores(scores, 3);
    if (chosen.length > 0) addIndices(selections.projectBulletIndices, projectIndex, chosen);
  }
  for (const [experienceIndex, scores] of experienceBulletScores.entries()) {
    // Full work history is retained later. These source indices identify the
    // direct evidence and safe transferable facts that may be foregrounded.
    const experience = resume.experience?.[experienceIndex];
    const direct = relevantIndicesForScores(scores, 3)
      .filter((bulletIndex) => hasSpecificRoleOrSkillEvidence(experience?.bullets[bulletIndex] ?? "", requirements));
    const transferable = relevantIndicesForScores(
      experienceTransferableScores[experienceIndex] ?? [],
      2,
    );
    const chosen = [...new Set([...direct, ...transferable])];
    if (chosen.length > 0) addIndices(selections.experienceBulletIndices, experienceIndex, chosen);
  }
  return {
    skillScores,
    projectScores,
    featuredProjectIndices: featuredIndices,
    projectTransferableScores,
    projectBulletScores,
    experienceBulletScores,
    experienceTransferableScores,
    experienceJobTransferableScores,
    selections,
  };
}

function sourceEvidenceForRequirement(input: {
  profile: Profile;
  requirement: TailoringRequirement;
  selections: TailorSelections;
  projectScores: readonly number[];
  experienceBulletScores: readonly number[][];
}): TailoringEvidence[] {
  const resume = input.profile.resumeJson;
  const evidence: TailoringEvidence[] = [];
  const projectIndices = descendingByScore(input.selections.projectIndices, (index) => input.projectScores[index] ?? 0);
  for (const projectIndex of projectIndices) {
    const project = resume.projects?.[projectIndex];
    if (!project) continue;
    const selectedBullets = [...(input.selections.projectBulletIndices.get(projectIndex) ?? [])].sort((left, right) => left - right);
    const matchingBullet = selectedBullets
      .map((bulletIndex) => project.bullets?.[bulletIndex])
      .find((bullet) => bullet && requirementMatchesText(input.requirement, bullet));
    const projectText = [project.name, project.description, ...(project.technologies ?? [])].join(" ");
    if (matchingBullet || requirementMatchesText(input.requirement, projectText)) {
      evidence.push({
        requirement: input.requirement.label,
        source: "project",
        label: matchingBullet ? `${project.name}: ${matchingBullet}` : `${project.name}: ${project.description}`,
        projectIndex,
      });
    }
  }
  for (const [experienceIndex, item] of (resume.experience ?? []).entries()) {
    const selected = descendingByScore(
      input.selections.experienceBulletIndices.get(experienceIndex) ?? [],
      (bulletIndex) => input.experienceBulletScores[experienceIndex]?.[bulletIndex] ?? 0,
    );
    for (const bulletIndex of selected) {
      const bullet = item.bullets[bulletIndex];
      if (!bullet || !requirementMatchesText(input.requirement, bullet)) continue;
      evidence.push({
        requirement: input.requirement.label,
        source: "experience",
        label: `${item.company} — ${item.title}: ${bullet}`,
        experienceIndex,
        bulletIndex,
      });
    }
  }
  for (const skill of input.selections.skills) {
    if (!requirementMatchesText(input.requirement, skill)) continue;
    evidence.push({
      requirement: input.requirement.label,
      source: "skill",
      label: skill,
      skill,
    });
  }
  return evidence;
}

function fallbackRoleEvidence(input: {
  profile: Profile;
  requirement: TailoringRequirement | undefined;
  requirements: readonly TailoringRequirement[];
  selections: TailorSelections;
  projectScores: readonly number[];
  projectTransferableScores: readonly number[];
  experienceBulletScores: readonly number[][];
  experienceJobTransferableScores: readonly number[][];
}): TailoringEvidence[] {
  if (!input.requirement) return [];
  const resume = input.profile.resumeJson;
  const evidence: TailoringEvidence[] = [];
  for (const projectIndex of descendingByScore(input.selections.projectIndices, (index) => input.projectScores[index] ?? 0)) {
    const project = resume.projects?.[projectIndex];
    if (!project) continue;
    const projectText = [project.name, project.description, ...(project.technologies ?? []), ...(project.bullets ?? [])].join(" ");
    if (
      !hasSpecificRoleOrSkillEvidence(projectText, input.requirements)
      && (input.projectTransferableScores[projectIndex] ?? 0) <= 0
    ) continue;
    evidence.push({
      requirement: input.requirement.label,
      source: "project",
      label: `${project.name}: ${project.description}`,
      projectIndex,
    });
  }
  for (const [experienceIndex, experience] of (resume.experience ?? []).entries()) {
    const selected = descendingByScore(
      input.selections.experienceBulletIndices.get(experienceIndex) ?? [],
      (bulletIndex) => input.experienceBulletScores[experienceIndex]?.[bulletIndex] ?? 0,
    );
    for (const bulletIndex of selected) {
      const bullet = experience.bullets[bulletIndex];
      if (!bullet) continue;
      if (
        !hasSpecificRoleOrSkillEvidence(bullet, input.requirements)
        && (input.experienceJobTransferableScores[experienceIndex]?.[bulletIndex] ?? 0) <= 0
      ) continue;
      evidence.push({
        requirement: input.requirement.label,
        source: "experience",
        label: `${experience.company} — ${experience.title}: ${bullet}`,
        experienceIndex,
        bulletIndex,
      });
    }
  }
  return evidence;
}

function dedupeEvidence(evidence: readonly TailoringEvidence[]): TailoringEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = [item.requirement, item.source, item.experienceIndex ?? "", item.bulletIndex ?? "", item.projectIndex ?? "", normalizedText(item.skill ?? item.label)].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createEvidenceMap(input: {
  profile: Profile;
  requirements: readonly TailoringRequirement[];
  selections: TailorSelections;
  projectScores: readonly number[];
  projectTransferableScores: readonly number[];
  experienceBulletScores: readonly number[][];
  experienceTransferableScores: readonly number[][];
  experienceJobTransferableScores: readonly number[][];
}): TailoringEvidence[] {
  const evidence = input.requirements
    .filter((requirement) => requirement.kind === "skill" || requirement.kind === "role")
    .flatMap((requirement) => sourceEvidenceForRequirement({ ...input, requirement }));
  const nonSkillFacts = evidence.filter((item) => item.source !== "skill");
  if (nonSkillFacts.length < 2) {
    evidence.push(...fallbackRoleEvidence({
      ...input,
      requirement: input.requirements.find((requirement) => requirement.kind === "role"),
    }));
  }
  return dedupeEvidence(evidence).slice(0, 24);
}

function fitAssessment(input: {
  profile: Profile;
  jobTitle: string;
  requirements: readonly TailoringRequirement[];
  evidenceMap: readonly TailoringEvidence[];
}): TailorFitAssessment {
  const facts = sourceText(input.profile);
  const gaps: string[] = [];
  let missingSkills = 0;
  let criticalGap = false;
  for (const requirement of input.requirements) {
    if (requirement.kind === "skill" && requirement.required && !requirementMatchesText(requirement, facts)) {
      gaps.push(`${requirement.label} is named in this role but is not recorded in the profile.`);
      missingSkills += 1;
    }
    if (requirement.kind === "clearance" && !requirementMatchesText(requirement, facts)) {
      gaps.push(`${requirement.label} is required or mentioned, and no clearance is recorded in the profile.`);
      criticalGap = true;
    }
    if (requirement.kind === "citizenship" && !requirementMatchesText(requirement, facts)) {
      gaps.push("U.S. citizenship is mentioned, and the profile does not document it.");
      criticalGap = true;
    }
    if (requirement.kind === "years") {
      const requiredYears = Number(/\d+/.exec(requirement.label)?.[0] ?? 0);
      const documented = yearsDocumented(input.profile.resumeJson);
      if (documented === null || documented < requiredYears) {
        gaps.push(`${requirement.label} is requested; the profile does not document enough dated experience to verify it.`);
      }
    }
  }
  const needsSeniority = input.requirements.some((requirement) => requirement.kind === "seniority");
  if (needsSeniority && !titleHasComparableSeniority(input.profile, input.jobTitle)) {
    gaps.push("This is a senior-level role, while comparable seniority is not documented in the profile.");
  }
  const seniorityConcern = gaps.some((gap) => /senior-level|years of experience/i.test(gap));
  const evidenceCount = input.evidenceMap.length;
  let level: TailorFitAssessment["level"];
  if (criticalGap || missingSkills >= 2 || (missingSkills >= 1 && seniorityConcern) || (evidenceCount === 0 && input.requirements.length > 1)) {
    level = "low";
  } else if (missingSkills > 0 || seniorityConcern || evidenceCount < 3) {
    level = "caution";
  } else {
    level = "strong";
  }
  const summary = level === "strong"
    ? `Strong factual evidence was found for this role (${evidenceCount} traceable matches).`
    : level === "caution"
      ? `Some relevant evidence was found (${evidenceCount} traceable matches), with gaps to review before applying.`
      : `The profile does not support a persuasive tailored application for this role (${evidenceCount} traceable matches).`;
  return { level, summary, gaps, evidenceCount };
}

/** Build a fully deterministic plan from the saved profile and current job snapshot. */
export function buildGroundedTailoringPlan(input: {
  profile: Profile;
  jobTitle: string;
  description: string;
}): GroundedTailoringPlan {
  const requirements = requirementsForJob(input.jobTitle, input.description);
  const ranked = rankSelections(input.profile, input.description, requirements);
  const evidenceMap = createEvidenceMap({
    profile: input.profile,
    requirements,
    selections: ranked.selections,
    projectScores: ranked.projectScores,
    projectTransferableScores: ranked.projectTransferableScores,
    experienceBulletScores: ranked.experienceBulletScores,
    experienceTransferableScores: ranked.experienceTransferableScores,
    experienceJobTransferableScores: ranked.experienceJobTransferableScores,
  });
  return {
    ...ranked,
    requirements,
    evidenceMap,
    fitAssessment: fitAssessment({
      profile: input.profile,
      jobTitle: input.jobTitle,
      requirements,
      evidenceMap,
    }),
  };
}

/** Merge an LLM's source references without letting it write or alter facts. */
export function mergeSelections(
  plan: GroundedTailoringPlan,
  profile: Profile,
  requested: SerializableTailorSelections,
): TailorSelections {
  const next = cloneSelections(plan.selections);
  const resume = profile.resumeJson;
  for (const projectIndex of requested.projectIndices ?? []) {
    if (Number.isInteger(projectIndex) && projectIndex >= 0 && projectIndex < (resume.projects?.length ?? 0)) {
      next.projectIndices.add(projectIndex);
    }
  }
  for (const selection of requested.projectBullets ?? []) {
    const project = resume.projects?.[selection.projectIndex];
    if (!project || !Number.isInteger(selection.projectIndex)) continue;
    addIndices(next.projectBulletIndices, selection.projectIndex, selection.bulletIndices.filter((index) => Number.isInteger(index) && index >= 0 && index < (project.bullets?.length ?? 0)));
  }
  for (const selection of requested.experienceBullets ?? []) {
    const experience = resume.experience?.[selection.experienceIndex];
    if (!experience || !Number.isInteger(selection.experienceIndex)) continue;
    // The model can suggest a transferable fact to foreground, but it cannot
    // alter text or make that fact technical evidence: evidence matching is
    // independently checked against each requirement below.
    addIndices(next.experienceBulletIndices, selection.experienceIndex, selection.bulletIndices.filter((index) =>
      Number.isInteger(index)
      && index >= 0
      && index < experience.bullets.length));
  }
  const profileSkills = canonicalSkills(profile);
  for (const requestedSkill of requested.skills ?? []) {
    const skill = profileSkills.find((candidate) => normalizedText(candidate) === normalizedText(requestedSkill));
    if (skill && (plan.skillScores.get(skill) ?? 0) > 0) next.skills.add(skill);
  }
  return limitSelections(plan, next);
}

/** Limit merged source selections while retaining their original-source identities. */
export function limitSelections(plan: GroundedTailoringPlan, selections: TailorSelections): TailorSelections {
  const projectLimit = Math.max(3, plan.featuredProjectIndices.length);
  const eligibleProjectIndices = new Set(selectedProjectIndices(
    plan.projectScores,
    plan.featuredProjectIndices,
    projectLimit,
  ));
  const projectIndices = new Set([
    ...selections.projectIndices,
    ...plan.featuredProjectIndices,
  ]);
  const limited: TailorSelections = {
    projectIndices: new Set(orderedProjectIndices(
      [...projectIndices].filter((index) => eligibleProjectIndices.has(index)),
      plan.projectScores,
      plan.featuredProjectIndices,
    ).slice(0, projectLimit)),
    projectBulletIndices: new Map(),
    experienceBulletIndices: new Map(),
    skills: new Set([...selections.skills]
      .sort((left, right) => (plan.skillScores.get(right) ?? 0) - (plan.skillScores.get(left) ?? 0) || left.localeCompare(right))
      .slice(0, 15)),
  };
  for (const [projectIndex, selected] of selections.projectBulletIndices) {
    if (!limited.projectIndices.has(projectIndex)) continue;
    const ranked = descendingByScore(selected, (bulletIndex) => plan.projectBulletScores[projectIndex]?.[bulletIndex] ?? 0).slice(0, 4);
    if (ranked.length > 0) limited.projectBulletIndices.set(projectIndex, new Set(ranked));
  }
  for (const [experienceIndex, selected] of selections.experienceBulletIndices) {
    const ranked = descendingByScore(selected, (bulletIndex) => plan.experienceBulletScores[experienceIndex]?.[bulletIndex] ?? 0).slice(0, 5);
    if (ranked.length > 0) limited.experienceBulletIndices.set(experienceIndex, new Set(ranked));
  }
  return limited;
}

function canUseTargetTitle(profile: Profile, jobTitle: string, assessment: TailorFitAssessment): boolean {
  if (assessment.level === "low") return false;
  const sourceTerms = new Set(terms([
    profile.resumeJson.headline,
    ...profile.titleAliases,
    ...(profile.resumeJson.experience ?? []).map((item) => item.title),
    ...(profile.resumeJson.projects ?? []).map((item) => item.name),
    ...canonicalSkills(profile),
  ].filter(Boolean).join(" ")));
  const targetTerms = terms(jobTitle);
  const meaningful = targetTerms.filter((term) => !genericTitleTerms.has(term));
  const overlap = meaningful.filter((term) => sourceTerms.has(term));
  return normalizedText(sourceText(profile)).includes(normalizedText(jobTitle)) || overlap.length >= 1 || targetTerms.filter((term) => sourceTerms.has(term)).length >= 2;
}

function sentence(value: string): string {
  const trimmed = value.trim().replace(/[.?!]+$/g, "");
  return trimmed ? `${trimmed}.` : "";
}

function sourceSummary(resume: ResumeProfileJson): string | undefined {
  const summary = resume.summary?.trim();
  if (!summary) return undefined;
  const first = summary.match(/^.*?[.?!](?:\s|$)/)?.[0] ?? summary;
  return sentence(first);
}

function orderedExperienceBulletIndices(input: {
  experience: NonNullable<ResumeProfileJson["experience"]>[number];
  experienceIndex: number;
  plan: GroundedTailoringPlan;
  selections: TailorSelections;
}): number[] {
  const selected = input.selections.experienceBulletIndices.get(input.experienceIndex) ?? new Set<number>();
  const priorityTier = (bulletIndex: number): number => {
    const bullet = input.experience.bullets[bulletIndex] ?? "";
    if (hasSpecificRoleOrSkillEvidence(bullet, input.plan.requirements)) return 0;
    if ((input.plan.experienceTransferableScores[input.experienceIndex]?.[bulletIndex] ?? 0) > 0) return 1;
    return 2;
  };

  return input.experience.bullets.map((_, index) => index).sort((left, right) => {
    const tierDifference = priorityTier(left) - priorityTier(right);
    if (tierDifference) return tierDifference;

    // Model selections are reviewable ranking suggestions, never a reason to
    // remove history. They only break ties among facts already relevant or
    // transferable; unrelated facts retain their source order.
    if (priorityTier(left) < 2) {
      const selectedDifference = Number(selected.has(right)) - Number(selected.has(left));
      if (selectedDifference) return selectedDifference;
      const transferableDifference = (input.plan.experienceTransferableScores[input.experienceIndex]?.[right] ?? 0)
        - (input.plan.experienceTransferableScores[input.experienceIndex]?.[left] ?? 0);
      if (transferableDifference) return transferableDifference;
      const evidenceDifference = (input.plan.experienceBulletScores[input.experienceIndex]?.[right] ?? 0)
        - (input.plan.experienceBulletScores[input.experienceIndex]?.[left] ?? 0);
      if (evidenceDifference) return evidenceDifference;
    }
    return left - right;
  });
}

/** Render a truthful resume: only top matter and source order change. */
export function resumeFromPlan(input: {
  profile: Profile;
  jobTitle: string;
  plan: GroundedTailoringPlan;
  selections?: TailorSelections;
}): ResumeProfileJson {
  const selections = input.selections ?? input.plan.selections;
  const resume = input.profile.resumeJson;
  if (input.plan.fitAssessment.level === "low") {
    // A low-fit result is a warning, not permission to make arbitrary
    // selections. Preserve the source resume while keeping its factual skills
    // readable when they are stored separately on the profile.
    return {
      ...resume,
      skills: (resume.skills?.length ? resume.skills : canonicalSkills(input.profile)).map(displaySkill),
    };
  }
  const selectedSkills = [...selections.skills]
    .sort((left, right) => (input.plan.skillScores.get(right) ?? 0) - (input.plan.skillScores.get(left) ?? 0) || left.localeCompare(right));
  const displaySkills = selectedSkills.map(displaySkill);
  const selectedProjects = orderedProjectIndices(
    selections.projectIndices,
    input.plan.projectScores,
    input.plan.featuredProjectIndices,
  )
    .map((projectIndex) => {
      const project = resume.projects?.[projectIndex];
      if (!project) return null;
      const selectedBullets = descendingByScore(
        selections.projectBulletIndices.get(projectIndex) ?? [],
        (bulletIndex) => input.plan.projectBulletScores[projectIndex]?.[bulletIndex] ?? 0,
      ).map((bulletIndex) => project.bullets?.[bulletIndex]).filter((bullet): bullet is string => Boolean(bullet));
      return { ...project, ...(project.bullets ? { bullets: selectedBullets } : {}) };
    })
    .filter((project): project is NonNullable<typeof project> => project !== null);
  const selectedExperience = (resume.experience ?? []).map((experience, experienceIndex) => {
    const orderedBullets = orderedExperienceBulletIndices({
      experience,
      experienceIndex,
      plan: input.plan,
      selections,
    }).map((bulletIndex) => experience.bullets[bulletIndex]).filter((bullet): bullet is string => Boolean(bullet));
    // Historic employer names, titles, dates, and every source bullet stay
    // intact. Target-specific and transferable facts are merely foregrounded.
    return { ...experience, bullets: orderedBullets };
  });
  const useTargetTitle = canUseTargetTitle(input.profile, input.jobTitle, input.plan.fitAssessment);
  const baseHeadline = resume.headline ?? input.profile.titleAliases[0];
  const headline = useTargetTitle
    ? [input.jobTitle, displaySkills.slice(0, 4).join(", ")].filter(Boolean).join(" | ")
    : [baseHeadline, displaySkills.slice(0, 3).join(", ")].filter(Boolean).join(" | ");
  const projectNames = selectedProjects.map((project) => project.name).slice(0, 3);
  const targetedSummary = [
    sourceSummary(resume),
    displaySkills.length > 0 ? sentence(`Relevant stack${useTargetTitle ? ` for this ${input.jobTitle} role` : ""}: ${displaySkills.slice(0, 5).join(", ")}`) : "",
    projectNames.length > 0 ? sentence(`Relevant projects include ${projectNames.join(", ")}`) : "",
  ].filter(Boolean).join(" ");
  return {
    ...resume,
    headline,
    summary: targetedSummary || resume.summary,
    skills: displaySkills,
    projects: selectedProjects,
    experience: selectedExperience,
  };
}

/** Recompute evidence and fit after an LLM has added valid source selections. */
export function planWithSelections(input: {
  profile: Profile;
  jobTitle: string;
  plan: GroundedTailoringPlan;
  selections: TailorSelections;
}): GroundedTailoringPlan {
  const selections = limitSelections(input.plan, input.selections);
  const evidenceMap = createEvidenceMap({
    profile: input.profile,
    requirements: input.plan.requirements,
    selections,
    projectScores: input.plan.projectScores,
    projectTransferableScores: input.plan.projectTransferableScores,
    experienceBulletScores: input.plan.experienceBulletScores,
    experienceTransferableScores: input.plan.experienceTransferableScores,
    experienceJobTransferableScores: input.plan.experienceJobTransferableScores,
  });
  return {
    ...input.plan,
    selections,
    evidenceMap,
    fitAssessment: fitAssessment({
      profile: input.profile,
      jobTitle: input.jobTitle,
      requirements: input.plan.requirements,
      evidenceMap,
    }),
  };
}

function coverLetterFacts(evidenceMap: readonly TailoringEvidence[]): TailoringEvidence[] {
  const facts: TailoringEvidence[] = [];
  const seen = new Set<string>();
  for (const item of evidenceMap) {
    if (item.source === "skill") continue;
    const key = `${item.source}:${item.experienceIndex ?? item.projectIndex ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(item);
    if (facts.length === 2) break;
  }
  return facts;
}

function lowerFirst(value: string): string {
  return value.length > 0 ? `${value[0]!.toLowerCase()}${value.slice(1)}` : value;
}

function firstSentence(value: string): string {
  return value.trim().match(/^.*?[.?!](?:\s|$)/)?.[0]?.trim() ?? value.trim();
}

function narrativeFact(fact: TailoringEvidence): string {
  const separator = ": ";
  const splitAt = fact.label.indexOf(separator);
  const context = splitAt >= 0 ? fact.label.slice(0, splitAt) : fact.label;
  const detail = firstSentence(splitAt >= 0 ? fact.label.slice(splitAt + separator.length) : fact.label);
  if (fact.source === "experience") {
    return `At ${context}, I ${lowerFirst(detail)}`;
  }
  return `One relevant project is ${context}: ${detail}`;
}

/** A job-aware letter composed only from the current job and selected source facts. */
export function groundedCoverLetter(input: {
  profile: Profile;
  companyName: string;
  jobTitle: string;
  plan: GroundedTailoringPlan;
}): string | null {
  if (input.plan.fitAssessment.level === "low") return null;
  const facts = coverLetterFacts(input.plan.evidenceMap);
  // A factual letter needs at least two selected work/project facts. Anything
  // less tends to fall back to generic persuasion, which we intentionally do
  // not generate.
  if (facts.length < 2) return null;
  const jobFocus = [...new Set(input.plan.evidenceMap
    .filter((item) => item.source === "skill" && item.requirement !== input.jobTitle)
    .map((item) => item.requirement))]
    .slice(0, 3);
  const paragraphs = [
    `Dear ${input.companyName} hiring team,`,
    [
      sentence(`I am applying for the ${input.jobTitle} role at ${input.companyName}`),
      jobFocus.length > 0
        ? sentence(`Your job description emphasizes ${jobFocus.join(", ")}, and I have highlighted relevant factual work in my resume`)
        : sentence("I have highlighted factual project and work examples that relate to the responsibilities in your job description"),
    ].join(" "),
    facts.map((fact) => sentence(narrativeFact(fact))).join(" "),
    "I would welcome the opportunity to discuss how these documented facts could support the team.",
    `Thank you,\n${input.profile.resumeJson.name ?? "[Your name]"}`,
  ];
  return paragraphs.join("\n\n");
}
