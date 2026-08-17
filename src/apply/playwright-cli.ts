import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { db, sqlite } from "@/db";
import { asLocalBrowserPage, launchLocalChromium } from "@/browser/playwright";

import { fillApplicationRun } from "./fill";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

interface FillOptions {
  runId: number;
  timeoutMs: number;
  headless: boolean;
  wait: boolean;
  browserPath?: string;
  help: boolean;
}

function usage(): string {
  return `Usage: pnpm apply:fill -- --run-id <id> [options]

Open a persisted ATS review plan in local Chromium and fill only its declared
fields. The browser exposes no submit operation; review custom questions and
click Submit yourself in the visible browser window.

Options:
  --run-id <n>          Application run to fill (required)
  --timeout-ms <n>      Browser operation timeout (default: 20000)
  --headless            Run Chromium without a visible window
  --no-wait             Close after filling (useful for smoke tests)
  --browser-path <path> Override the local Chromium executable
  --help, -h            Show this help
`;
}

function positiveInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} requires a positive integer`);
  return parsed;
}

export function parseArgs(args: readonly string[]): FillOptions {
  let runId: number | undefined;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let headless = false;
  let wait = true;
  let browserPath: string | undefined;
  let help = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") help = true;
    else if (argument === "--headless") headless = true;
    else if (argument === "--no-wait") wait = false;
    else if (argument === "--run-id") runId = positiveInteger(args[++index] ?? "", "--run-id");
    else if (argument?.startsWith("--run-id=")) runId = positiveInteger(argument.slice("--run-id=".length), "--run-id");
    else if (argument === "--timeout-ms") timeoutMs = positiveInteger(args[++index] ?? "", "--timeout-ms");
    else if (argument?.startsWith("--timeout-ms=")) timeoutMs = positiveInteger(argument.slice("--timeout-ms=".length), "--timeout-ms");
    else if (argument === "--browser-path") {
      browserPath = args[++index];
      if (!browserPath) throw new Error("--browser-path requires a path");
    } else if (argument?.startsWith("--browser-path=")) {
      browserPath = argument.slice("--browser-path=".length);
      if (!browserPath) throw new Error("--browser-path requires a path");
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (timeoutMs > MAX_TIMEOUT_MS) throw new Error(`--timeout-ms must be at most ${MAX_TIMEOUT_MS}`);
  if (!help && runId === undefined) throw new Error("--run-id is required");
  return { runId: runId ?? 0, timeoutMs, headless, wait, browserPath, help };
}

function waitForHumanStop(session: { browser: { once(event: "disconnected", listener: () => void): unknown } }): Promise<void> {
  return new Promise((resolveStop) => {
    const stop = () => {
      process.stdin.pause();
      process.removeListener("SIGINT", stop);
      resolveStop();
    };
    process.once("SIGINT", stop);
    process.stdin.once("data", stop);
    process.stdin.resume();
    session.browser.once("disconnected", stop);
  });
}

export async function main(args: readonly string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(args);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const session = await launchLocalChromium({
    headless: options.headless,
    executablePath: options.browserPath,
    timeoutMs: options.timeoutMs,
  });
  try {
    const result = await fillApplicationRun({
      runId: options.runId,
      page: asLocalBrowserPage(session.page, options.timeoutMs),
      database: db,
    });
    console.log(JSON.stringify(result, null, 2));
    if (options.wait) {
      console.log("Fields filled. Review the visible browser, answer custom questions, and submit manually. Press Enter or close the browser when done.");
      await waitForHumanStop(session);
    }
    return 0;
  } finally {
    await session.close().catch(() => undefined);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().then(
    (exitCode) => { process.exitCode = exitCode; },
    (error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; },
  ).finally(() => sqlite.close());
}

