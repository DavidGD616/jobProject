import type { NormalizedPosting } from "@/sources";

import {
  htmlToText,
  normalizeRemoteType,
  normalizeTitle,
} from "../normalize";
import type { RemoteType } from "../normalize";
import type { AshbyJob } from "./schema";

type SalaryPeriod = "year" | "month" | "hour";

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

type AshbySecondaryLocation = NonNullable<
  AshbyJob["secondaryLocations"]
>[number];

function secondaryLocationName(value: AshbySecondaryLocation): string | null {
  return typeof value === "string" ? text(value) : text(value.location);
}

function normalizeLocation(raw: Readonly<AshbyJob>): string | null {
  const locations = [
    text(raw.location),
    ...(raw.secondaryLocations ?? []).map(secondaryLocationName),
  ].filter((location): location is string => location !== null);

  return [...new Set(locations)].join(" / ") || null;
}

function normalizeAshbyRemoteType(
  raw: Readonly<AshbyJob>,
  location: string | null,
): RemoteType {
  const workplaceType = text(raw.workplaceType);
  const normalizedWorkplace = normalizeRemoteType(workplaceType);
  if (normalizedWorkplace !== "unknown") return normalizedWorkplace;

  if (/\b(?:in[- ]?person|in[- ]?office)\b/i.test(workplaceType ?? "")) {
    return "onsite";
  }
  if (raw.isRemote === true) return "remote";

  return normalizeRemoteType(location);
}

function salaryPeriod(value: string | null | undefined): SalaryPeriod | null {
  const interval = value?.trim().toLowerCase();
  if (!interval) return null;
  if (/\byears?\b/.test(interval)) return "year";
  if (/\bmonths?\b/.test(interval)) return "month";
  if (/\bhours?\b/.test(interval)) return "hour";
  return null;
}

function salaryComponents(raw: Readonly<AshbyJob>) {
  const summaryComponents = raw.compensation?.summaryComponents ?? [];
  const summarySalaryComponents = summaryComponents.filter(
    (component) => component.compensationType?.toLowerCase() === "salary",
  );
  if (summarySalaryComponents.length > 0) return summarySalaryComponents;

  return (raw.compensation?.compensationTiers ?? []).flatMap((tier) =>
    (tier.components ?? []).filter(
      (component) => component.compensationType?.toLowerCase() === "salary",
    ),
  );
}

function validAmount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function normalizeSalary(
  raw: Readonly<AshbyJob>,
): Pick<
  NormalizedPosting,
  "salaryMin" | "salaryMax" | "salaryPeriod" | "currency"
> {
  const components = salaryComponents(raw)
    .map((component) => ({
      currency: text(component.currencyCode)?.toUpperCase() ?? null,
      period: salaryPeriod(component.interval),
      minValue: validAmount(component.minValue),
      maxValue: validAmount(component.maxValue),
    }))
    .filter(
      (component) =>
        component.currency !== null &&
        component.period !== null &&
        (component.minValue !== null || component.maxValue !== null),
    );

  if (components.length === 0) {
    return {
      salaryMin: null,
      salaryMax: null,
      salaryPeriod: null,
      currency: null,
    };
  }

  const currencies = new Set(components.map((component) => component.currency));
  const periods = new Set(components.map((component) => component.period));
  if (currencies.size !== 1 || periods.size !== 1) {
    return {
      salaryMin: null,
      salaryMax: null,
      salaryPeriod: null,
      currency: null,
    };
  }

  const minimums = components
    .map((component) => component.minValue)
    .filter((value): value is number => value !== null);
  const maximums = components
    .map((component) => component.maxValue)
    .filter((value): value is number => value !== null);

  return {
    salaryMin: minimums.length > 0 ? Math.min(...minimums) : null,
    salaryMax: maximums.length > 0 ? Math.max(...maximums) : null,
    salaryPeriod: periods.values().next().value ?? null,
    currency: currencies.values().next().value ?? null,
  };
}

export function normalize(raw: Readonly<AshbyJob>): NormalizedPosting {
  const location = normalizeLocation(raw);
  const description = raw.descriptionHtml?.trim()
    ? raw.descriptionHtml
    : raw.descriptionPlain ?? "";

  return {
    url: raw.jobUrl,
    title: raw.title.trim(),
    titleNorm: normalizeTitle(raw.title),
    description: htmlToText(description),
    location,
    remoteType: normalizeAshbyRemoteType(raw, location),
    postedAt: parseDate(raw.publishedAt),
    ...normalizeSalary(raw),
  };
}

export function sourceId(raw: Readonly<AshbyJob>): string {
  return raw.id;
}
