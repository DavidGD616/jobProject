import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { eq } from "drizzle-orm";

import {
  companies,
  db,
  getExtractionRule,
  ingestSourceSnapshot,
  recordExtractionResult,
  shouldRegenerateRule,
  sqlite,
} from "@/db";
import type { JobHuntDatabase } from "@/db";
import {
  extractCareerPagePostings,
  normalizeCareerPagePosting,
  renderCareerPage,
} from "@/sources";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface CareerFetchOptions {
  companyId: number;
  timeoutMs: number;
  htmlFile?: string;
  help: boolean;
}

export interface CareerFetchDependencies {
  database?: JobHuntDatabase;
  fetchImpl?: typeof fetch;
  readFileImpl?: typeof readFile;
  now?: () => Date;
}

function usage(): string {
  return `Usage: pnpm career:fetch -- --company-id <id> [options]

Fetch one discovered company's career page, apply its cached extraction rule,
and ingest the resulting postings into the local SQLite database. A zero-row
snapshot is recorded as a rule failure and is never treated as an empty board.

Options:
  --company-id <n>      Company row to fetch (required)
  --timeout-ms <n>      HTML request timeout (default: 20000)
  --html-file <path>    Read a saved rendered HTML snapshot instead of HTTP
  --help, -h            Show this help
`;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${option} requires a positive integer`);
  }
  return parsed;
}

export function parseArgs(args: readonly string[]): CareerFetchOptions {
  let companyId: number | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let htmlFile: string | undefined;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--company-id") {
      companyId = positiveInteger(args[++index] ?? "", "--company-id");
    } else if (argument?.startsWith("--company-id=")) {
      companyId = positiveInteger(argument.slice("--company-id=".length), "--company-id");
    } else if (argument === "--timeout-ms") {
      timeoutMs = positiveInteger(args[++index] ?? "", "--timeout-ms");
    } else if (argument?.startsWith("--timeout-ms=")) {
      timeoutMs = positiveInteger(argument.slice("--timeout-ms=".length), "--timeout-ms");
    } else if (argument === "--html-file") {
      htmlFile = args[++index];
      if (!htmlFile) throw new Error("--html-file requires a path");
    } else if (argument?.startsWith("--html-file=")) {
      htmlFile = argument.slice("--html-file=".length);
      if (!htmlFile) throw new Error("--html-file requires a path");
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`--timeout-ms must be at most ${MAX_TIMEOUT_MS}`);
  }
  if (!help && companyId === undefined) {
    throw new Error("--company-id is required");
  }
  return { companyId: companyId ?? 0, timeoutMs, htmlFile, help };
}

async function fetchHtml(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "job-hunt-agent/1.0 (+local career page fetch)",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Career page returned HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timer);
  }
}

export async function runOnce(
  options: Pick<CareerFetchOptions, "companyId" | "timeoutMs" | "htmlFile">,
  dependencies: CareerFetchDependencies = {},
) {
  const database = dependencies.database ?? db;
  const company = database.select().from(companies).where(eq(companies.id, options.companyId)).get();
  if (!company) throw new Error(`Company ${options.companyId} not found`);
  if (!company.careersUrl) throw new Error(`Company ${company.name} has no careers URL`);

  let careersUrl: URL;
  try {
    careersUrl = new URL(company.careersUrl);
  } catch {
    throw new Error(`Company ${company.name} has an invalid careers URL`);
  }
  if (!/^https?:$/.test(careersUrl.protocol)) {
    throw new Error(`Company ${company.name} careers URL must use HTTP(S)`);
  }

  const rule = getExtractionRule({
    companyId: company.id,
    domain: careersUrl.hostname,
    database,
  });
  if (!rule) {
    throw new Error(`No extraction rule for ${careersUrl.hostname}; save one before fetching`);
  }

  const readFileImpl = dependencies.readFileImpl ?? readFile;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  let renderedHtml: string;
  if (options.htmlFile) {
    renderedHtml = await readFileImpl(resolve(options.htmlFile), "utf8");
  } else {
    let body = "";
    renderedHtml = await renderCareerPage(
      {
        async goto(url) {
          body = await fetchHtml(url, options.timeoutMs, fetchImpl);
        },
        async content() {
          return body;
        },
      },
      careersUrl.toString(),
    );
  }

  const extracted = extractCareerPagePostings(
    renderedHtml,
    rule.selectors,
    careersUrl.toString(),
  );
  const now = dependencies.now ?? (() => new Date());
  const updatedRule = recordExtractionResult({
    ruleId: rule.id,
    count: extracted.length,
    database,
    now: now(),
  });
  if (extracted.length === 0) {
    const regeneration = shouldRegenerateRule(updatedRule)
      ? " Regenerate the selectors before the next run."
      : "";
    throw new Error(`Career page extraction returned zero postings.${regeneration}`);
  }

  const ingestion = await ingestSourceSnapshot(database, {
    company,
    source: "career_page",
    postings: extracted.map((posting) => ({
      sourceId: posting.sourceId,
      posting: normalizeCareerPagePosting(posting),
    })),
    observedAt: now(),
  });
  return {
    companyId: company.id,
    company: company.name,
    domain: careersUrl.hostname,
    extracted: extracted.length,
    extractionRuleId: rule.id,
    regenerateRule: shouldRegenerateRule(updatedRule),
    ingestion,
  };
}

export async function main(
  args: readonly string[] = process.argv.slice(2),
  dependencies: CareerFetchDependencies = {},
  output: (value: string) => void = console.log,
): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    output(usage());
    return 0;
  }
  output(JSON.stringify(await runOnce(options, dependencies), null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  ).finally(() => {
    sqlite.close();
  });
}
