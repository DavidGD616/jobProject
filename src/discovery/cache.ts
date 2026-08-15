import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { discoveryCacheVersion } from "./config";

export interface NegativeProbeCache {
  has(key: string): boolean;
  mark(key: string): void;
  clear(key: string): void;
  entries(): Iterable<readonly [string, number]>;
}

export function createNegativeProbeCache(
  initial: Iterable<readonly [string, number]> = [],
): NegativeProbeCache {
  const misses = new Map(initial);

  return {
    has(key) {
      return misses.has(key);
    },
    mark(key) {
      misses.set(key, Date.now());
    },
    clear(key) {
      misses.delete(key);
    },
    entries() {
      return misses.entries();
    },
  };
}

export function loadNegativeProbeCache(path: string): NegativeProbeCache {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(path), "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      (parsed as { version?: unknown }).version !== discoveryCacheVersion
    ) {
      return createNegativeProbeCache();
    }

    const misses = (parsed as { misses?: unknown }).misses;
    if (!misses || typeof misses !== "object") {
      return createNegativeProbeCache();
    }

    const entries = Object.entries(misses).filter(
      (entry): entry is [string, number] =>
        typeof entry[0] === "string" && typeof entry[1] === "number",
    );
    return createNegativeProbeCache(entries);
  } catch {
    return createNegativeProbeCache();
  }
}

export function saveNegativeProbeCache(
  path: string,
  cache: NegativeProbeCache,
): void {
  const misses = Object.fromEntries(cache.entries());
  const target = resolve(path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    `${JSON.stringify({ version: discoveryCacheVersion, misses }, null, 2)}\n`,
    "utf8",
  );
}
