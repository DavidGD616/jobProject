import type { NormalizedPosting } from "@/sources";

import { htmlToText, normalizeRemoteType, normalizeTitle } from "../normalize";
import type { RemoteType } from "../normalize";
import type { LeverJob } from "./schema";

type SalaryPeriod = "year" | "month" | "hour";

function textOrNull(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function normalizedLocation(raw: Readonly<LeverJob>): string | null {
  const allLocations = raw.categories?.allLocations
    ?.map((location) => location.trim())
    .filter(Boolean);
  if (allLocations?.length) {
    return [...new Set(allLocations)].join(" / ");
  }

  return textOrNull(raw.categories?.location);
}

function normalizedRemoteType(
  raw: Readonly<LeverJob>,
  location: string | null,
): RemoteType {
  const fromWorkplace = normalizeRemoteType(raw.workplaceType);
  return fromWorkplace === "unknown"
    ? normalizeRemoteType(location)
    : fromWorkplace;
}

function salaryPeriod(value: string | null | undefined): SalaryPeriod | null {
  switch (value?.trim().toLowerCase()) {
    case "year":
    case "yearly":
    case "per-year":
    case "per-year-salary":
      return "year";
    case "month":
    case "monthly":
    case "per-month":
    case "per-month-salary":
      return "month";
    case "hour":
    case "hourly":
    case "per-hour":
    case "per-hour-salary":
      return "hour";
    default:
      return null;
  }
}

function normalizedSalary(
  raw: Readonly<LeverJob>,
): Pick<
  NormalizedPosting,
  "salaryMin" | "salaryMax" | "salaryPeriod" | "currency"
> {
  const range = raw.salaryRange;
  if (!range) return {};

  const period = salaryPeriod(range.interval);
  const currency = textOrNull(range.currency)?.toUpperCase();

  return {
    ...(range.min === null || range.min === undefined
      ? {}
      : { salaryMin: range.min }),
    ...(range.max === null || range.max === undefined
      ? {}
      : { salaryMax: range.max }),
    ...(period ? { salaryPeriod: period } : {}),
    ...(currency ? { currency } : {}),
  };
}

function normalizedDescription(raw: Readonly<LeverJob>): string {
  const primaryDescription =
    [raw.description, raw.descriptionBody, raw.descriptionPlain].find((value) =>
      Boolean(value?.trim()),
    ) ?? "";
  const listParts =
    raw.lists?.flatMap((list) => [list.text ?? "", list.content ?? ""]) ?? [];

  return htmlToText(
    [primaryDescription, raw.opening ?? "", ...listParts, raw.additional ?? ""]
      .filter((part) => part.trim())
      .join("\n\n"),
  );
}

function postedAt(value: number | null | undefined): Date | null {
  return value === null || value === undefined ? null : new Date(value);
}

export function normalize(raw: Readonly<LeverJob>): NormalizedPosting {
  const location = normalizedLocation(raw);

  return {
    url: raw.hostedUrl,
    title: raw.text.trim(),
    titleNorm: normalizeTitle(raw.text),
    description: normalizedDescription(raw),
    location,
    remoteType: normalizedRemoteType(raw, location),
    postedAt: postedAt(raw.createdAt),
    ...normalizedSalary(raw),
  };
}

export function sourceId(raw: Readonly<LeverJob>): string {
  return raw.id;
}
