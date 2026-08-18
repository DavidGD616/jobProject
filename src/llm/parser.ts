import type { ZodType } from "zod";

export interface ParsedJson<T> {
  value: T | null;
  candidate: string | null;
  error?: string;
}

function stripAnsi(input: string): string {
  return input.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}

function fencedJson(input: string): string | null {
  const match = input.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match?.[1]?.trim() ?? null;
}

function balancedJson(input: string): string | null {
  const start = [...input].findIndex((character) => character === "{" || character === "[");
  if (start < 0) return null;
  const open = input[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  return null;
}

export function extractJsonCandidate(input: string): string | null {
  const cleaned = stripAnsi(input).trim();
  return fencedJson(cleaned) ?? balancedJson(cleaned);
}

export function parseStructured<T>(
  input: string,
  schema: ZodType<T>,
): ParsedJson<T> {
  const candidate = extractJsonCandidate(input);
  if (!candidate) return { value: null, candidate: null, error: "no JSON object found" };
  let decoded: unknown;
  try {
    decoded = JSON.parse(candidate);
  } catch (cause) {
    return {
      value: null,
      candidate,
      error: `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }
  const result = schema.safeParse(decoded);
  if (!result.success) {
    return {
      value: null,
      candidate,
      error: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    };
  }
  return { value: result.data, candidate };
}
