import { delay } from "./rate-limit";
import type { SourceRequestLimiter } from "./rate-limit";

const MAX_TIMEOUT_MS = 2_147_483_647;

interface RobotsRule {
  allowed: boolean;
  pattern: string;
}

interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelayMs: number | null;
  hasDirective: boolean;
}

export interface RobotsPolicy {
  allows(url: string): boolean;
  /** The strictest matching `Crawl-delay`, or zero when none is published. */
  crawlDelayMs: number;
}

export const allowAllRobotsPolicy: RobotsPolicy = {
  allows: () => true,
  crawlDelayMs: 0,
};

export interface FetchRobotsPolicyConfig {
  /** Any URL on the origin whose robots policy should be read. */
  targetUrl: string;
  userAgent: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  signal?: AbortSignal;
}

export interface FetchRobotsPolicyDependencies {
  fetchImpl?: typeof globalThis.fetch;
  sleep?: typeof delay;
  now?: () => number;
  requestLimiter: SourceRequestLimiter;
}

export class RobotsPolicyError extends Error {
  readonly status: number | undefined;
  readonly url: string;

  constructor(
    message: string,
    options: { url: string; status?: number; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "RobotsPolicyError";
    this.status = options.status;
    this.url = options.url;
  }
}

function userAgentProduct(value: string): string {
  return value.trim().split(/[\s/]/, 1)[0]!.toLocaleLowerCase();
}

function pathMatches(pattern: string, url: string): boolean {
  const target = new URL(url);
  const path = `${target.pathname}${target.search}`;
  const anchored = pattern.endsWith("$");
  const source = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

function parseGroups(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.slice(0, rawLine.indexOf("#") >= 0
      ? rawLine.indexOf("#")
      : rawLine.length).trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLocaleLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      if (!value) continue;
      if (!current || current.hasDirective) {
        current = {
          userAgents: [],
          rules: [],
          crawlDelayMs: null,
          hasDirective: false,
        };
        groups.push(current);
      }
      current.userAgents.push(value.toLocaleLowerCase());
      continue;
    }

    if (!current) continue;
    if (field === "allow" || field === "disallow") {
      current.hasDirective = true;
      // A blank Disallow is explicitly an allow-all rule, not a zero-length
      // disallow that would block the entire origin.
      if (field === "disallow" && !value) continue;
      if (value) {
        current.rules.push({ allowed: field === "allow", pattern: value });
      }
      continue;
    }
    if (field === "crawl-delay") {
      current.hasDirective = true;
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelayMs = Math.max(
          current.crawlDelayMs ?? 0,
          Math.round(seconds * 1_000),
        );
      }
    }
  }

  return groups;
}

function matchingGroups(groups: readonly RobotsGroup[], userAgent: string): RobotsGroup[] {
  const product = userAgentProduct(userAgent);
  let specificity = -1;
  const matches: RobotsGroup[] = [];

  for (const group of groups) {
    const groupSpecificity = Math.max(
      ...group.userAgents.map((agent) =>
        agent === "*" ? 0 : product.includes(agent) ? agent.length : -1,
      ),
    );
    if (groupSpecificity < specificity || groupSpecificity < 0) continue;
    if (groupSpecificity > specificity) {
      specificity = groupSpecificity;
      matches.length = 0;
    }
    matches.push(group);
  }

  return matches;
}

/** Parse a robots.txt response according to the allow/disallow matching rules. */
export function parseRobotsPolicy(text: string, userAgent: string): RobotsPolicy {
  const groups = matchingGroups(parseGroups(text), userAgent);
  const rules = groups.flatMap((group) => group.rules);
  const crawlDelayMs = Math.max(
    0,
    ...groups.map((group) => group.crawlDelayMs ?? 0),
  );

  return {
    allows(url: string): boolean {
      let matchingRule: RobotsRule | undefined;
      for (const rule of rules) {
        if (!pathMatches(rule.pattern, url)) continue;
        const ruleLength = rule.pattern.replace(/[\*$]/g, "").length;
        const currentLength = matchingRule
          ? matchingRule.pattern.replace(/[\*$]/g, "").length
          : -1;
        if (
          ruleLength > currentLength ||
          (ruleLength === currentLength && rule.allowed)
        ) {
          matchingRule = rule;
        }
      }
      return matchingRule?.allowed ?? true;
    },
    crawlDelayMs,
  };
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

function requestSignal(config: FetchRobotsPolicyConfig): AbortSignal {
  const timeout = AbortSignal.timeout(config.timeoutMs);
  return config.signal ? AbortSignal.any([config.signal, timeout]) : timeout;
}

function robotsUrl(targetUrl: string): string {
  const target = new URL(targetUrl);
  return new URL("/robots.txt", target.origin).toString();
}

/**
 * Fetch a robots policy through the caller's source limiter. Per RFC 9309,
 * a 4xx response other than 429 means the policy is unavailable and may be
 * treated as no restrictions; transient failures remain fail-closed here.
 */
export async function fetchRobotsPolicy(
  config: FetchRobotsPolicyConfig,
  dependencies: FetchRobotsPolicyDependencies,
): Promise<RobotsPolicy> {
  if (
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs < 0 ||
    config.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new RangeError("robots timeoutMs must be within Node's timer range");
  }
  if (!Number.isInteger(config.maxAttempts) || config.maxAttempts < 1) {
    throw new RangeError("robots maxAttempts must be a positive integer");
  }
  if (!Number.isFinite(config.retryBaseDelayMs) || config.retryBaseDelayMs < 0) {
    throw new RangeError("robots retryBaseDelayMs must be finite and non-negative");
  }
  if (!config.userAgent.trim()) {
    throw new RangeError("robots userAgent must not be empty");
  }

  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? delay;
  const now = dependencies.now ?? Date.now;
  const url = robotsUrl(config.targetUrl);

  return dependencies.requestLimiter.run(async () => {
    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
      let response: Response;
      try {
        await dependencies.requestLimiter.waitForRequestSlot(config.signal);
        response = await fetchImpl(url, {
          headers: {
            Accept: "text/plain",
            "User-Agent": config.userAgent,
          },
          redirect: "manual",
          signal: requestSignal(config),
        });
      } catch (cause) {
        if (config.signal?.aborted || attempt === config.maxAttempts) {
          throw new RobotsPolicyError("robots.txt request failed", { url, cause });
        }
        await sleep(backoffMs(config.retryBaseDelayMs, attempt), config.signal);
        continue;
      }

      // RFC 9309 §2.3.1.4 allows a crawler to access an origin whose robots
      // file is unavailable. 429 remains a rate-limit signal, not absence.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return allowAllRobotsPolicy;
      }

      if (!response.ok) {
        const retryDelayMs =
          retryAfterMs(response.headers.get("retry-after"), now) ??
          backoffMs(config.retryBaseDelayMs, attempt);
        dependencies.requestLimiter.deferFor(retryDelayMs);
        if (attempt === config.maxAttempts) {
          throw new RobotsPolicyError(
            `robots.txt returned HTTP ${response.status}`,
            { url, status: response.status },
          );
        }
        await sleep(retryDelayMs, config.signal);
        continue;
      }

      const contentType = response.headers.get("content-type");
      if (contentType && !/^text\/plain(?:;|$)/i.test(contentType)) {
        throw new RobotsPolicyError("robots.txt did not return text/plain", {
          url,
          status: response.status,
        });
      }
      try {
        return parseRobotsPolicy(await response.text(), config.userAgent);
      } catch (cause) {
        throw new RobotsPolicyError("robots.txt response could not be parsed", {
          url,
          status: response.status,
          cause,
        });
      }
    }

    throw new RobotsPolicyError("robots.txt request exhausted retries", { url });
  }, config.signal);
}
