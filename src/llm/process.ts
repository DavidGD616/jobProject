import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export class ProviderProcessError extends Error {
  readonly status: "timeout" | "rate_limited" | "error";
  readonly rawOutput: string;
  readonly exitCode: number | null;

  constructor(input: {
    message: string;
    status: "timeout" | "rate_limited" | "error";
    rawOutput?: string;
    exitCode?: number | null;
  }) {
    super(input.message);
    this.name = "ProviderProcessError";
    this.status = input.status;
    this.rawOutput = input.rawOutput ?? "";
    this.exitCode = input.exitCode ?? null;
  }
}

export interface CliInvocationResult {
  stdout: string;
  stderr: string;
  durationMs: number;
}

function isRateLimited(text: string): boolean {
  return /rate.?limit|too many requests|quota|overloaded|429/i.test(text);
}

function killProcessGroup(child: ReturnType<typeof spawn>): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Run an installed agent CLI in a fresh empty directory. The argv array is
 * passed directly to spawn so job descriptions can contain shell syntax.
 */
export async function runCli(
  command: string,
  args: readonly string[],
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<CliInvocationResult> {
  const cwd = await mkdtemp(join(tmpdir(), "job-hunt-llm-"));
  const startedAt = Date.now();
  const child = spawn(command, [...args], {
    cwd,
    detached: true,
    env: { ...process.env, NO_COLOR: "1", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted = false;
  const abort = () => {
    aborted = true;
    killProcessGroup(child);
  };
  options.signal?.addEventListener("abort", abort, { once: true });

  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        timer = setTimeout(() => {
          killProcessGroup(child);
          reject(
            new ProviderProcessError({
              message: `provider timed out after ${options.timeoutMs}ms`,
              status: "timeout",
              rawOutput: Buffer.concat([...stdout, ...stderr]).toString("utf8"),
            }),
          );
        }, options.timeoutMs);
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    const out = Buffer.concat(stdout).toString("utf8");
    const err = Buffer.concat(stderr).toString("utf8");
    if (aborted) {
      throw new ProviderProcessError({
        message: "provider invocation aborted",
        status: "timeout",
        rawOutput: `${out}\n${err}`,
        exitCode: result.code,
      });
    }
    if (result.code !== 0) {
      const combined = `${out}\n${err}`.trim();
      throw new ProviderProcessError({
        message: combined || `provider exited with code ${result.code ?? "unknown"}`,
        status: isRateLimited(combined) ? "rate_limited" : "error",
        rawOutput: combined,
        exitCode: result.code,
      });
    }
    return {
      stdout: out,
      stderr: err,
      durationMs: Date.now() - startedAt,
    };
  } catch (cause) {
    if (cause instanceof ProviderProcessError) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ProviderProcessError({
      message,
      status: isRateLimited(message) ? "rate_limited" : "error",
      rawOutput: Buffer.concat([...stdout, ...stderr]).toString("utf8"),
    });
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    await rm(cwd, { recursive: true, force: true });
  }
}
