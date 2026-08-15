import { decodeHTML } from "entities";
import { z } from "zod";

import { createSourceRequestLimiter, delay } from "../sources/rate-limit";
import type { SourceRequestLimiter } from "../sources/rate-limit";
import { fetchRobotsPolicy } from "../sources/robots";
import type { RobotsPolicy } from "../sources/robots";
import type { CandidateCompany, DiscoveryAtsType } from "./_contract";
import { slugVariants } from "./slugify";

const HN_ALGOLIA_API_URL = "https://hn.algolia.com/api/v1";
const MAX_TIMEOUT_MS = 2_147_483_647;
const monthlyHiringTitle = /^Ask HN: Who is hiring\? \([A-Za-z]+ \d{4}\)$/i;

const algoliaHitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullable().optional(),
  comment_text: z.string().nullable().optional(),
  parent_id: z.number().int().nullable().optional(),
});
const algoliaSearchSchema = z.object({
  hits: z.array(algoliaHitSchema),
  // Algolia returns zero for a valid query with no matching comments.
  nbPages: z.number().int().nonnegative().optional(),
});

export interface HnHiringDiscoveryConfig {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  maxConcurrentRequests: number;
  minRequestIntervalMs: number;
  storySearchHitsPerPage: number;
  maxStories: number;
  maxStoryPages: number;
  commentHitsPerPage: number;
  maxCommentPages: number;
  userAgent: string;
}

export const hnHiringDiscoveryConfig = {
  timeoutMs: 10_000,
  maxAttempts: 2,
  retryBaseDelayMs: 500,
  maxConcurrentRequests: 1,
  minRequestIntervalMs: 1_000,
  storySearchHitsPerPage: 100,
  // Three years of monthly threads produced 424 unique ATS-hinted candidates
  // in the initial live parser-only check: enough headroom for the 300-board
  // Phase 1 exit without turning one invocation into an unbounded crawl.
  maxStories: 36,
  maxStoryPages: 10,
  commentHitsPerPage: 1_000,
  maxCommentPages: 10,
  userAgent:
    "job-hunt-agent/0.1 (+https://github.com/DavidGD616/jobProject/issues)",
} as const satisfies HnHiringDiscoveryConfig;

export interface HnHiringDiscoveryDependencies {
  fetchImpl?: typeof globalThis.fetch;
  sleep?: typeof delay;
  now?: () => number;
  limiter?: SourceRequestLimiter;
  /** Injectable policy for deterministic tests or a pre-approved source. */
  robotsPolicy?: RobotsPolicy;
}

export interface HnHiringStory {
  id: string;
  title: string;
}

export interface HnHiringDiscoverOptions {
  storyId?: string | number;
  signal?: AbortSignal;
}

export interface HnHiringDiscovery {
  discover(options?: HnHiringDiscoverOptions): Promise<CandidateCompany[]>;
  findLatestStory(signal?: AbortSignal): Promise<HnHiringStory>;
  findRecentStories(signal?: AbortSignal): Promise<HnHiringStory[]>;
}

export class HnHiringDiscoveryError extends Error {
  readonly status: number | undefined;
  readonly url: string;

  constructor(
    message: string,
    options: { url: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "HnHiringDiscoveryError";
    this.status = options.status;
    this.url = options.url;
  }
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function retryAfterMs(value: string | null, now: () => number): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

  const dateMs = Date.parse(value);
  return Number.isNaN(dateMs) ? null : Math.max(0, dateMs - now());
}

function backoffMs(baseDelayMs: number, attempt: number): number {
  return Math.min(Math.max(0, baseDelayMs) * 2 ** (attempt - 1), 8_000);
}

function requestSignal(
  config: HnHiringDiscoveryConfig,
  signal?: AbortSignal,
): AbortSignal {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function normalizedConfig(
  overrides: Partial<HnHiringDiscoveryConfig>,
): HnHiringDiscoveryConfig {
  const config = { ...hnHiringDiscoveryConfig, ...overrides };
  const positiveIntegers: Array<[keyof HnHiringDiscoveryConfig, number]> = [
    ["timeoutMs", config.timeoutMs],
    ["maxAttempts", config.maxAttempts],
    ["maxConcurrentRequests", config.maxConcurrentRequests],
    ["storySearchHitsPerPage", config.storySearchHitsPerPage],
    ["maxStories", config.maxStories],
    ["maxStoryPages", config.maxStoryPages],
    ["commentHitsPerPage", config.commentHitsPerPage],
    ["maxCommentPages", config.maxCommentPages],
  ];
  for (const [name, value] of positiveIntegers) {
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive integer`);
    }
  }
  if (config.timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError("timeoutMs must be within Node's timer range");
  }
  if (
    !Number.isFinite(config.retryBaseDelayMs) ||
    config.retryBaseDelayMs < 0
  ) {
    throw new RangeError("retryBaseDelayMs must be finite and non-negative");
  }
  if (
    !Number.isFinite(config.minRequestIntervalMs) ||
    config.minRequestIntervalMs < 0
  ) {
    throw new RangeError("minRequestIntervalMs must be finite and non-negative");
  }
  if (!config.userAgent.trim()) {
    throw new RangeError("userAgent must not be empty");
  }
  return config;
}

function plainText(html: string): string {
  return decodeHTML(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|blockquote|pre)>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  ).replace(/\u00a0/g, " ");
}

function validCompanyName(name: string): string | null {
  const normalized = name.trim().replace(/[\s,;:]+$/, "");
  if (
    normalized.length < 2 ||
    normalized.length > 120 ||
    !/\p{L}/u.test(normalized) ||
    /^(?:https?:\/\/|www\.)/i.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

/**
 * Parse a conventional HN heading. This helper intentionally recognizes the
 * common pipe form too, but the automatic seed only admits explicit
 * `Company:` headings paired with an official ATS URL (see below).
 */
export function parseHnHiringCompanyLine(line: string): string | null {
  const trimmed = line.trim();
  const labeled = trimmed.match(/^company(?:\s+name)?\s*:\s*(.+)$/i);
  if (labeled) return validCompanyName(labeled[1]!.split(/\s+\|\s+/, 1)[0]!);

  // HN's own posting template commonly starts `Company | role | location`.
  // It is deliberately only a candidate hint; every result is still checked
  // against an official ATS board before it can enter the database.
  const [name, ...fields] = trimmed.split("|");
  return fields.length > 0 ? validCompanyName(name!) : null;
}

function parseExplicitCompanyHeading(line: string): string | null {
  const labeled = line
    .trim()
    .match(/^company(?:\s+name)?\s*:\s*(.+)$/i);
  return labeled
    ? validCompanyName(labeled[1]!.split(/\s+\|\s+/, 1)[0]!)
    : null;
}

interface HnCompanyHeading {
  name: string;
  explicit: boolean;
}

function parseHnCompanyHeading(line: string): HnCompanyHeading | null {
  const explicit = parseExplicitCompanyHeading(line);
  if (explicit) return { name: explicit, explicit: true };

  const pipeDelimited = parseHnHiringCompanyLine(line);
  // HN posters often append a cohort/funding shorthand to the company field
  // (for example, `PermitFlow (YC W22)`). It is not part of the board token.
  const name = pipeDelimited?.replace(/\s*\([^)]{1,80}\)\s*$/, "").trim();
  return name ? { name, explicit: false } : null;
}

interface AtsUrlHint {
  atsType: DiscoveryAtsType;
  atsToken: string;
  index: number;
}

const atsUrlPatterns: ReadonlyArray<{
  atsType: DiscoveryAtsType;
  pattern: RegExp;
}> = [
  {
    atsType: "greenhouse",
    pattern:
      /https?:\/\/(?:boards|job-boards)\.greenhouse\.io\/([^/?#\s<>"']+)/i,
  },
  {
    atsType: "lever",
    pattern: /https?:\/\/jobs\.lever\.co\/([^/?#\s<>"']+)/i,
  },
  {
    atsType: "ashby",
    pattern: /https?:\/\/jobs\.ashbyhq\.com\/([^/?#\s<>"']+)/i,
  },
];

function extractAtsUrlHint(commentText: string): AtsUrlHint | null {
  const decoded = decodeHTML(commentText);
  const matches = atsUrlPatterns.flatMap(({ atsType, pattern }) => {
    const match = pattern.exec(decoded);
    if (!match?.[1] || match.index === undefined) return [];
    return [{ atsType, atsToken: match[1], index: match.index }];
  });
  return matches.sort((left, right) => left.index - right.index)[0] ?? null;
}

function headingMatchesAtsToken(name: string, atsToken: string): boolean {
  const normalizedToken = atsToken
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return slugVariants(name).some(
    (variant) => variant.replace(/-/g, "") === normalizedToken,
  );
}

/**
 * Extract a safely actionable HN listing. Arbitrary pipe-delimited prose is
 * deliberately excluded unless the candidate name exactly matches the board
 * token: it frequently begins with a role, location, or person's name. A
 * listing must include an exact official ATS board URL, which also lets the
 * verifier make one hinted request instead of guessing across every provider.
 */
export function parseHnHiringCandidate(
  commentText: string,
): CandidateCompany | null {
  const atsHint = extractAtsUrlHint(commentText);
  if (!atsHint) return null;

  for (const line of plainText(commentText).split(/\r?\n/)) {
    const heading = parseHnCompanyHeading(line);
    if (
      !heading ||
      (!heading.explicit && !headingMatchesAtsToken(heading.name, atsHint.atsToken))
    ) {
      continue;
    }
    return {
      name: heading.name,
      atsType: atsHint.atsType,
      atsToken: atsHint.atsToken,
      discoveredVia: "hn_hiring",
    };
  }
  return null;
}

/** Extract one safely actionable company name from an HN comment fragment. */
export function parseHnHiringComment(commentText: string): string | null {
  return parseHnHiringCandidate(commentText)?.name ?? null;
}

function apiUrl(path: string, searchParams: Record<string, string>): string {
  const url = new URL(`${HN_ALGOLIA_API_URL}/${path}`);
  for (const [name, value] of Object.entries(searchParams)) {
    url.searchParams.set(name, value);
  }
  return url.toString();
}

export function createHnHiringDiscovery(
  configOverrides: Partial<HnHiringDiscoveryConfig> = {},
  dependencyOverrides: HnHiringDiscoveryDependencies = {},
): HnHiringDiscovery {
  const config = normalizedConfig(configOverrides);
  const fetchImpl = dependencyOverrides.fetchImpl ?? globalThis.fetch;
  const sleep = dependencyOverrides.sleep ?? delay;
  const now = dependencyOverrides.now ?? Date.now;
  const limiter =
    dependencyOverrides.limiter ??
    createSourceRequestLimiter({
      maxConcurrentRequests: config.maxConcurrentRequests,
      minRequestIntervalMs: config.minRequestIntervalMs,
      });
  let robotsPolicyPromise: Promise<RobotsPolicy> | undefined;

  async function robotsPolicyFor(
    url: string,
    signal?: AbortSignal,
  ): Promise<RobotsPolicy> {
    if (dependencyOverrides.robotsPolicy) return dependencyOverrides.robotsPolicy;
    if (!robotsPolicyPromise) {
      const loadedPolicy = fetchRobotsPolicy(
        {
          targetUrl: url,
          userAgent: config.userAgent,
          timeoutMs: config.timeoutMs,
          maxAttempts: config.maxAttempts,
          retryBaseDelayMs: config.retryBaseDelayMs,
          signal,
        },
        { fetchImpl, sleep, now, requestLimiter: limiter },
      );
      robotsPolicyPromise = loadedPolicy.catch((cause) => {
        robotsPolicyPromise = undefined;
        throw cause;
      });
    }
    return robotsPolicyPromise;
  }

  async function fetchSearch(
    url: string,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof algoliaSearchSchema>> {
    let robotsPolicy: RobotsPolicy;
    try {
      robotsPolicy = await robotsPolicyFor(url, signal);
    } catch (cause) {
      throw new HnHiringDiscoveryError("HN robots.txt policy could not be checked", {
        url,
        cause,
      });
    }
    if (!robotsPolicy.allows(url)) {
      throw new HnHiringDiscoveryError("HN robots.txt disallows this API path", {
        url,
      });
    }
    limiter.raiseMinRequestIntervalMs(robotsPolicy.crawlDelayMs);

    return limiter.run(async () => {
      for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
        let response: Response;
        try {
          await limiter.waitForRequestSlot(signal);
          response = await fetchImpl(url, {
            headers: {
              Accept: "application/json",
              "User-Agent": config.userAgent,
            },
            signal: requestSignal(config, signal),
          });
        } catch (cause) {
          if (signal?.aborted) throw cause;
          if (attempt === config.maxAttempts) {
            throw new HnHiringDiscoveryError("HN request failed", {
              url,
              cause,
            });
          }
          await sleep(backoffMs(config.retryBaseDelayMs, attempt), signal);
          continue;
        }

        if (!response.ok) {
          const retryDelayMs =
            retryAfterMs(response.headers.get("retry-after"), now) ??
            backoffMs(config.retryBaseDelayMs, attempt);
          if (retryableStatus(response.status) && attempt < config.maxAttempts) {
            limiter.deferFor(retryDelayMs);
            await sleep(retryDelayMs, signal);
            continue;
          }
          throw new HnHiringDiscoveryError(`HN returned HTTP ${response.status}`, {
            url,
            status: response.status,
          });
        }

        let payload: unknown;
        try {
          payload = await response.json();
        } catch (cause) {
          throw new HnHiringDiscoveryError("HN returned invalid JSON", {
            url,
            status: response.status,
            cause,
          });
        }
        const parsed = algoliaSearchSchema.safeParse(payload);
        if (!parsed.success) {
          throw new HnHiringDiscoveryError(
            "HN response did not match the expected search contract",
            { url, status: response.status },
          );
        }
        return parsed.data;
      }

      throw new HnHiringDiscoveryError("HN request exhausted retries", { url });
    }, signal);
  }

  async function findRecentStories(
    signal?: AbortSignal,
  ): Promise<HnHiringStory[]> {
    const searchParams = {
      query: "Ask HN: Who is hiring?",
      tags: "story",
      hitsPerPage: String(config.storySearchHitsPerPage),
    };
    const stories: HnHiringStory[] = [];
    const seenStoryIds = new Set<string>();
    let pageCount = 1;
    let lastUrl = apiUrl("search_by_date", { ...searchParams, page: "0" });

    for (let page = 0; page < config.maxStoryPages; page += 1) {
      const url = apiUrl("search_by_date", {
        ...searchParams,
        page: String(page),
      });
      lastUrl = url;
      const response = await fetchSearch(url, signal);
      pageCount = response.nbPages ?? 1;

      for (const hit of response.hits) {
        if (
          !hit.title ||
          !monthlyHiringTitle.test(hit.title) ||
          seenStoryIds.has(hit.objectID)
        ) {
          continue;
        }
        seenStoryIds.add(hit.objectID);
        stories.push({ id: hit.objectID, title: hit.title });
        if (stories.length === config.maxStories) return stories;
      }

      if (page + 1 >= pageCount) break;
    }

    if (stories.length < config.maxStories && pageCount > config.maxStoryPages) {
      throw new HnHiringDiscoveryError(
        `HN story search has ${pageCount} pages; configured maximum is ${config.maxStoryPages}`,
        { url: lastUrl },
      );
    }
    if (stories.length === 0) {
      throw new HnHiringDiscoveryError(
        "Could not find a monthly Ask HN: Who is hiring? story",
        { url: lastUrl },
      );
    }
    return stories;
  }

  async function findLatestStory(signal?: AbortSignal): Promise<HnHiringStory> {
    return (await findRecentStories(signal))[0]!;
  }

  async function discover(
    options: HnHiringDiscoverOptions = {},
  ): Promise<CandidateCompany[]> {
    const stories = options.storyId
      ? [{ id: options.storyId.toString(), title: "explicit HN story" }]
      : await findRecentStories(options.signal);
    const candidates: CandidateCompany[] = [];
    const seenCandidateNames = new Set<string>();

    const addCandidates = (
      story: HnHiringStory,
      hits: readonly z.infer<typeof algoliaHitSchema>[],
    ) => {
      const storyId = Number(story.id);
      for (const hit of hits) {
        // Algolia includes replies under the story tag. Only top-level comments
        // are independent company listings; replies are discussion context.
        if (hit.parent_id !== storyId || !hit.comment_text) continue;
        const candidate = parseHnHiringCandidate(hit.comment_text);
        if (!candidate) continue;
        const key = candidate.name.toLocaleLowerCase();
        if (seenCandidateNames.has(key)) continue;
        seenCandidateNames.add(key);
        candidates.push(candidate);
      }
    };

    for (const story of stories) {
      if (!/^\d+$/.test(story.id)) {
        throw new RangeError("storyId must be a Hacker News numeric item ID");
      }

      const commentsParams = {
        tags: `comment,story_${story.id}`,
        hitsPerPage: String(config.commentHitsPerPage),
      };
      const firstCommentsUrl = apiUrl("search_by_date", commentsParams);
      const firstPage = await fetchSearch(firstCommentsUrl, options.signal);
      const pageCount = firstPage.nbPages ?? 1;
      if (pageCount > config.maxCommentPages) {
        throw new HnHiringDiscoveryError(
          `HN hiring thread has ${pageCount} pages; configured maximum is ${config.maxCommentPages}`,
          { url: firstCommentsUrl },
        );
      }

      addCandidates(story, firstPage.hits);
      for (let page = 1; page < pageCount; page += 1) {
        const response = await fetchSearch(
          apiUrl("search_by_date", { ...commentsParams, page: String(page) }),
          options.signal,
        );
        addCandidates(story, response.hits);
      }
    }

    return candidates;
  }

  return { discover, findLatestStory, findRecentStories };
}

const defaultHnHiringDiscovery = createHnHiringDiscovery();

/** Discover candidates from the latest structured HN hiring thread. */
export const discoverHnHiring = defaultHnHiringDiscovery.discover;

/** Resolve the latest monthly HN hiring thread for reproducible seed runs. */
export const findLatestHnHiringStory = defaultHnHiringDiscovery.findLatestStory;

/** Resolve the rolling automatic seed of recent monthly HN hiring threads. */
export const findRecentHnHiringStories = defaultHnHiringDiscovery.findRecentStories;
