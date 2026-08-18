import Link from "next/link";

import { displayCompanyName } from "@/db";
import { listOpenJobs, parseJobListFilters } from "@/db/job-list";

import { CompanyPicker } from "./company-picker";
import { AppNav } from "./nav";

export const runtime = "nodejs";

type PageProps = {
  searchParams: Promise<{
    company?: string | string[];
    title?: string | string[];
    date?: string | string[];
  }>;
};

const dateWindowLabels = {
  all: "Any date",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
} as const;

function formatDate(value: Date | null): string {
  if (!value) return "Recently added";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: value.getUTCFullYear() === new Date().getUTCFullYear() ? undefined : "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatSalary(input: {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: string | null;
}): string | null {
  if (input.min === null && input.max === null) return null;
  const formatter = input.currency
    ? new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: input.currency,
      maximumFractionDigits: 0,
    })
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const range = input.min !== null && input.max !== null
    ? `${formatter.format(input.min)}–${formatter.format(input.max)}`
    : formatter.format(input.min ?? input.max ?? 0);
  return input.period ? `${range} / ${input.period}` : range;
}

function remoteLabel(remoteType: string | null): string | null {
  if (!remoteType || remoteType === "unknown") return null;
  return remoteType === "onsite" ? "On-site" : `${remoteType[0]?.toUpperCase()}${remoteType.slice(1)}`;
}

function filterSummary(input: {
  companyName: string | null;
  title: string | null;
  dateWindow: keyof typeof dateWindowLabels;
}): string[] {
  return [
    input.companyName ? `Company: ${input.companyName}` : null,
    input.title ? `Title: “${input.title}”` : null,
    input.dateWindow !== "all" ? dateWindowLabels[input.dateWindow] : null,
  ].filter((value): value is string => value !== null);
}

export default async function Home({ searchParams }: PageProps) {
  const filters = parseJobListFilters(await searchParams);
  const data = listOpenJobs(filters);
  const visibleCount = data.jobs.length;
  const hasFilters = Boolean(filters.company || filters.title || filters.dateWindow !== "all");
  const companyOptions = data.companies.map((company) => ({
    ...company,
    name: displayCompanyName(company.name),
  }));
  const selectedCompany = companyOptions.find((company) => company.slug === filters.company)?.name ?? null;
  const activeFilters = filterSummary({
    companyName: selectedCompany,
    title: filters.title,
    dateWindow: filters.dateWindow,
  });
  const newestListing = data.jobs[0]?.postedAt ?? data.jobs[0]?.firstSeenAt ?? null;

  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-9" id="main-content">
      <div className="mx-auto max-w-[1480px]">
        <AppNav />

        <div className="space-y-5 pt-5 sm:space-y-6 sm:pt-6">
          <header className="overflow-hidden rounded-[2rem] border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[var(--paper)] p-6 shadow-sm sm:p-8 lg:p-10">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(21rem,0.75fr)] lg:items-end">
              <div>
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--ink-soft)]">
                  <span className="inline-flex items-center gap-2 rounded-full bg-[color:color-mix(in_srgb,var(--rust)_11%,transparent)] px-3 py-1.5 text-[var(--rust)]">
                    <span aria-hidden="true" className="size-2 rounded-full bg-current" />
                    Open roles
                  </span>
                  <span>Official company boards, kept locally</span>
                </div>
                <h1 className="mt-5 max-w-3xl font-serif text-4xl leading-[0.98] tracking-[-0.045em] text-[var(--ink)] sm:text-5xl lg:text-6xl">
                  Find the next role worth your time.
                </h1>
                <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--ink-soft)] sm:text-lg">
                  Start with fresh openings, then use Matches to compare promising roles with your profile before you track, tailor, and apply.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-[var(--paper)] shadow-sm transition hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]"
                    href="#role-results"
                  >
                    Browse latest roles <span aria-hidden="true">↓</span>
                  </a>
                  <Link
                    className="inline-flex items-center gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_14%,transparent)] bg-[var(--paper)] px-4 py-3 text-sm font-semibold text-[var(--ink)] transition hover:border-[var(--rust)] hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]"
                    href="/review"
                  >
                    See your matches <span aria-hidden="true">→</span>
                  </Link>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
                <div className="rounded-2xl bg-[color:color-mix(in_srgb,var(--ink)_5%,transparent)] p-4 sm:p-5">
                  <dt className="text-sm text-[var(--muted)]">Open now</dt>
                  <dd className="mt-2 font-serif text-3xl tracking-[-0.04em] text-[var(--ink)] sm:text-4xl">
                    {data.total.toLocaleString()}
                  </dd>
                  <p className="mt-1 text-xs leading-4 text-[var(--muted)]">roles in this view</p>
                </div>
                <div className="rounded-2xl bg-[color:color-mix(in_srgb,var(--ink)_5%,transparent)] p-4 sm:p-5">
                  <dt className="text-sm text-[var(--muted)]">Companies</dt>
                  <dd className="mt-2 font-serif text-3xl tracking-[-0.04em] text-[var(--ink)] sm:text-4xl">
                    {data.openCompanies.toLocaleString()}
                  </dd>
                  <p className="mt-1 text-xs leading-4 text-[var(--muted)]">live boards in the workspace</p>
                </div>
                <div className="col-span-2 rounded-2xl border border-[color:color-mix(in_srgb,var(--rust)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--rust)_8%,transparent)] p-4 sm:col-span-3 sm:p-5 lg:col-span-2">
                  <dt className="text-sm font-medium text-[var(--ink-soft)]">Latest listing in this view</dt>
                  <dd className="mt-1 text-lg font-semibold tracking-[-0.02em] text-[var(--ink)]">
                    {newestListing ? formatDate(newestListing) : "Waiting for the first role"}
                  </dd>
                  <p className="mt-1 text-xs leading-4 text-[var(--muted)]">
                    {newestListing ? "Sorted by the newest posted or first-seen role." : "New official listings will appear here as they become available."}
                  </p>
                </div>
              </dl>
            </div>
          </header>

          <section
            aria-labelledby="filters-heading"
            className="rounded-[1.5rem] border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[var(--paper)] p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div>
                <h2 className="text-xl font-semibold tracking-[-0.025em] text-[var(--ink)]" id="filters-heading">
                  Find roles to explore
                </h2>
                <p className="mt-1 text-sm leading-5 text-[var(--muted)]">
                  Search by company, title, or when the role was posted. Your view stays in the URL so you can return to it.
                </p>
              </div>
              {hasFilters ? (
                <Link
                  className="w-fit text-sm font-semibold text-[var(--rust)] underline decoration-[var(--rust)]/40 underline-offset-4 transition hover:decoration-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]"
                  href="/"
                >
                  Clear all filters
                </Link>
              ) : null}
            </div>

            <form aria-label="Filter open roles" className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_12rem_auto] lg:items-end" method="get">
              <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]">
                Company
                <CompanyPicker companies={companyOptions} defaultSlug={filters.company} />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]" htmlFor="title">
                Job title or keyword
                <input
                  className="h-12 w-full rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_14%,transparent)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--rust)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--rust)]"
                  defaultValue={filters.title ?? ""}
                  id="title"
                  name="title"
                  placeholder="For example, product, data, or design"
                  type="search"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]" htmlFor="date">
                Posted
                <select
                  className="h-12 w-full rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_14%,transparent)] bg-[var(--paper)] px-3 text-sm text-[var(--ink)] outline-none transition focus:border-[var(--rust)] focus:outline-2 focus:outline-offset-2 focus:outline-[var(--rust)]"
                  defaultValue={filters.dateWindow}
                  id="date"
                  name="date"
                >
                  <option value="all">Any date</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
              </label>
              <button
                className="inline-flex h-12 items-center justify-center rounded-xl bg-[var(--rust)] px-5 text-sm font-semibold text-[var(--paper)] shadow-sm transition hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]"
                type="submit"
              >
                Show roles
              </button>
            </form>

            {activeFilters.length > 0 ? (
              <div aria-live="polite" className="mt-4 flex flex-wrap items-center gap-2 text-sm text-[var(--ink-soft)]">
                <span>Showing:</span>
                {activeFilters.map((filter) => (
                  <span className="rounded-full bg-[color:color-mix(in_srgb,var(--rust)_10%,transparent)] px-3 py-1.5 font-medium text-[var(--ink)]" key={filter}>
                    {filter}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
            <section
              aria-labelledby="roles-heading"
              className="min-w-0 rounded-[1.5rem] border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[var(--paper)] shadow-sm"
              id="role-results"
            >
              <div className="flex flex-col gap-3 border-b border-[color:color-mix(in_srgb,var(--ink)_11%,transparent)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
                <div>
                  <p className="text-sm font-medium text-[var(--rust)]">Open roles</p>
                  <h2 className="mt-1 font-serif text-3xl tracking-[-0.04em] text-[var(--ink)]" id="roles-heading">
                    {data.total === 0 ? "No roles in this view" : `${data.total.toLocaleString()} role${data.total === 1 ? "" : "s"} to explore`}
                  </h2>
                </div>
                <p aria-live="polite" className="text-sm leading-5 text-[var(--muted)]">
                  {data.total > visibleCount
                    ? `Showing the newest ${visibleCount.toLocaleString()} of ${data.total.toLocaleString()}.`
                    : `${visibleCount.toLocaleString()} role${visibleCount === 1 ? "" : "s"} loaded.`}
                </p>
              </div>

              {visibleCount > 0 ? (
                <ol className="grid gap-3 p-4 sm:p-5">
                  {data.jobs.map((job, index) => {
                    const salary = formatSalary({
                      min: job.salaryMin,
                      max: job.salaryMax,
                      currency: job.currency,
                      period: job.salaryPeriod,
                    });
                    const remote = remoteLabel(job.remoteType);
                    const companyName = displayCompanyName(job.companyName);
                    const titleId = `job-${job.id}-title`;
                    return (
                      <li key={job.id}>
                        <article
                          aria-labelledby={titleId}
                          className="[content-visibility:auto] rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[var(--paper)] p-4 transition duration-150 hover:-translate-y-px hover:border-[color:color-mix(in_srgb,var(--rust)_58%,transparent)] hover:shadow-md sm:p-5"
                        >
                          <div className="grid gap-4 lg:grid-cols-[2.5rem_minmax(0,1fr)_auto] lg:items-start">
                            <span aria-hidden="true" className="grid size-9 place-items-center rounded-full bg-[color:color-mix(in_srgb,var(--ink)_7%,transparent)] text-xs font-bold text-[var(--ink-soft)]">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-[var(--ink-soft)]">{companyName}</p>
                              <h3 className="mt-1 font-serif text-2xl leading-[1.08] tracking-[-0.032em] text-[var(--ink)] sm:text-[1.7rem]" id={titleId}>
                                <Link
                                  className="rounded-sm transition hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]"
                                  href={`/jobs/${job.id}`}
                                >
                                  {job.title}
                                </Link>
                              </h3>
                              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-sm leading-5 text-[var(--muted)]">
                                <span>{formatDate(job.postedAt ?? job.firstSeenAt)}</span>
                                <span>{job.location ?? "Location not listed"}</span>
                                {job.seniority ? <span className="capitalize">{job.seniority}</span> : null}
                              </div>
                              {remote || salary ? (
                                <div className="mt-4 flex flex-wrap gap-2">
                                  {remote ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--rust)_10%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--ink)]">{remote}</span> : null}
                                  {salary ? <span className="rounded-full bg-[color:color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--ink-soft)]">{salary}</span> : null}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-wrap gap-2 lg:justify-end">
                              <Link
                                className="inline-flex items-center justify-center rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]"
                                href={`/jobs/${job.id}`}
                              >
                                Explore role
                              </Link>
                              <a
                                aria-label={`Open the original posting for ${job.title} at ${companyName} in a new tab`}
                                className="inline-flex items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--ink)_14%,transparent)] px-3 py-2 text-sm font-semibold text-[var(--ink-soft)] transition hover:border-[var(--rust)] hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]"
                                href={job.url}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Original <span aria-hidden="true" className="ml-1">↗</span>
                              </a>
                            </div>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="grid min-h-[380px] place-items-center px-6 py-14 text-center sm:px-10">
                  <div className="max-w-md">
                    <p className="text-sm font-semibold text-[var(--rust)]">
                      {hasFilters ? "Try a broader search" : "Your workspace is ready for its first roles"}
                    </p>
                    <h3 className="mt-3 font-serif text-3xl tracking-[-0.04em] text-[var(--ink)]">
                      {hasFilters ? "No opening matches these filters." : "No open roles have been added yet."}
                    </h3>
                    <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                      {hasFilters
                        ? "Clear a filter or widen the date range to look across more company boards."
                        : "Official roles will appear here as they become available. Once they do, this is where you can explore them."}
                    </p>
                    {hasFilters ? (
                      <Link className="mt-6 inline-flex rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-[var(--paper)] transition hover:bg-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]" href="/">
                        Clear filters
                      </Link>
                    ) : null}
                  </div>
                </div>
              )}
            </section>

            <aside className="grid gap-4 xl:sticky xl:top-6 xl:self-start">
              <section className="rounded-[1.5rem] border border-[color:color-mix(in_srgb,var(--rust)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--rust)_8%,transparent)] p-5">
                <p className="text-sm font-semibold text-[var(--rust)]">A simple next step</p>
                <h2 className="mt-2 font-serif text-2xl leading-tight tracking-[-0.035em] text-[var(--ink)]">
                  See a role that stands out?
                </h2>
                <p className="mt-3 text-sm leading-6 text-[var(--ink-soft)]">
                  Explore the role details first. When you are ready to compare it with your profile, open Matches.
                </p>
                <Link className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-[var(--rust)] px-4 py-3 text-sm font-semibold text-[var(--paper)] shadow-sm transition hover:-translate-y-px hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-[var(--rust)]" href="/review">
                  Open Matches <span aria-hidden="true" className="ml-2">→</span>
                </Link>
              </section>

              <section className="rounded-[1.5rem] border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[var(--paper)] p-5 shadow-sm">
                <h2 className="text-base font-semibold text-[var(--ink)]">What you are looking at</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                  {data.openCompanies.toLocaleString()} discovered company boards. These are currently open, canonical roles from official sources—not copied social listings.
                </p>
                <p className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4 text-sm leading-6 text-[var(--ink-soft)]">
                  The newest 100 roles stay here for a fast first pass. Use the filters above to make the list yours.
                </p>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
