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

export default async function Home({ searchParams }: PageProps) {
  const filters = parseJobListFilters(await searchParams);
  const data = listOpenJobs(filters);
  const visibleCount = data.jobs.length;
  const hasFilters = Boolean(filters.company || filters.title || filters.dateWindow !== "all");
  const companyOptions = data.companies.map((company) => ({ ...company, name: displayCompanyName(company.name) }));

  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-10" id="main-content">
      <div className="ledger-shell mx-auto max-w-[1480px] overflow-hidden border border-[var(--ledger-border)] bg-[var(--paper)] shadow-[0_24px_80px_rgba(45,35,17,0.12)]">
        <AppNav />
        <header className="ledger-masthead relative overflow-hidden px-6 py-7 text-[var(--paper)] sm:px-9 sm:py-9 lg:px-12">
          <div className="relative flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div>
              <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--signal)]">
                Local opportunity ledger · phase 01
              </p>
              <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.92] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
                A clear desk for the work ahead.
              </h1>
              <p className="mt-5 max-w-xl text-sm leading-6 text-[color:rgba(255,250,238,0.72)] sm:text-base">
                Official career-board openings, refreshed locally and kept in one calm place.
              </p>
            </div>
            <dl className="grid max-w-md grid-cols-2 border-t border-[color:rgba(255,250,238,0.22)] lg:border-t-0 lg:border-l">
              <div className="px-0 pt-4 lg:px-6 lg:pt-0">
                <dt className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[color:rgba(255,250,238,0.55)]">
                  Open roles
                </dt>
                <dd className="mt-1 font-serif text-3xl tracking-[-0.04em]">{data.total.toLocaleString()}</dd>
              </div>
              <div className="border-l border-[color:rgba(255,250,238,0.22)] px-5 pt-4 lg:px-6 lg:pt-0">
                <dt className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-[color:rgba(255,250,238,0.55)]">
                  Live boards
                </dt>
                <dd className="mt-1 font-serif text-3xl tracking-[-0.04em]">{data.openCompanies.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="grid lg:grid-cols-[minmax(220px,0.27fr)_minmax(0,1fr)]">
          <aside className="border-b border-[var(--ledger-border)] bg-[var(--paper-deep)] p-6 lg:border-r lg:border-b-0 lg:p-8">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">View controls</p>
                <h2 className="mt-1 font-serif text-2xl tracking-[-0.03em] text-[var(--ink)]">Narrow the field</h2>
              </div>
              {hasFilters ? (
                <Link className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--rust)] underline decoration-1 underline-offset-4" href="/">
                  Reset
                </Link>
              ) : null}
            </div>

            <form className="mt-7 grid gap-5" method="get">
              <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]">
                Company
                <CompanyPicker companies={companyOptions} defaultSlug={filters.company} />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]" htmlFor="title">
                Title contains
                <input
                  className="ledger-control"
                  defaultValue={filters.title ?? ""}
                  id="title"
                  name="title"
                  placeholder="e.g. product, data, design"
                  type="search"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold text-[var(--ink)]" htmlFor="date">
                Posted
                <select className="ledger-control" defaultValue={filters.dateWindow} id="date" name="date">
                  <option value="all">Any time</option>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
              </label>

              <button className="ledger-button mt-1" type="submit">Apply view</button>
            </form>

            <p className="mt-8 border-t border-[var(--ledger-border)] pt-5 text-xs leading-5 text-[var(--muted)]">
              Results are canonical, currently open postings from discovered official boards. Filters live in the URL, so every useful view is shareable on this machine.
            </p>
          </aside>

          <section aria-labelledby="roles-heading" className="min-w-0">
            <div className="flex flex-col justify-between gap-3 border-b border-[var(--ledger-border)] px-6 py-5 sm:flex-row sm:items-center sm:px-8">
              <div>
                <p className="font-mono text-[0.65rem] font-bold uppercase tracking-[0.2em] text-[var(--muted)]">Review queue</p>
                <h2 className="mt-1 font-serif text-2xl tracking-[-0.03em] text-[var(--ink)]" id="roles-heading">
                  {data.total === 0 ? "No openings in this view" : `${data.total.toLocaleString()} opening${data.total === 1 ? "" : "s"}`}
                </h2>
              </div>
              {data.total > visibleCount ? (
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-[var(--muted)]">
                  Showing newest {visibleCount} of {data.total}
                </p>
              ) : (
                <p aria-live="polite" className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-[var(--muted)]">
                  {visibleCount} loaded
                </p>
              )}
            </div>

            {visibleCount > 0 ? (
              <ol className="divide-y divide-[var(--ledger-border)]">
                {data.jobs.map((job, index) => {
                  const salary = formatSalary({
                    min: job.salaryMin,
                    max: job.salaryMax,
                    currency: job.currency,
                    period: job.salaryPeriod,
                  });
                  const remote = remoteLabel(job.remoteType);
                  return (
                    <li className="job-row group grid gap-4 px-6 py-6 sm:px-8 lg:grid-cols-[2.4rem_minmax(0,1fr)_minmax(11rem,0.38fr)] lg:gap-5" key={job.id}>
                      <p className="font-mono text-[0.66rem] font-bold tracking-[0.16em] text-[var(--rust)]">
                        {String(index + 1).padStart(2, "0")}
                      </p>
                      <div className="min-w-0">
                        <div className="flex max-w-full items-baseline gap-2">
                          <Link className="truncate font-serif text-2xl leading-[1.05] tracking-[-0.035em] text-[var(--ink)] transition-colors hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)] sm:text-[1.7rem]" href={`/jobs/${job.id}`}>{job.title}</Link>
                          <a aria-label={`Open ${job.title} at ${displayCompanyName(job.companyName)} in a new tab`} className="shrink-0 font-sans text-base text-[var(--muted)] transition-colors hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)]" href={job.url} rel="noreferrer" target="_blank"><span aria-hidden="true">↗</span></a>
                        </div>
                        <p className="mt-2 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(job.companyName)}</p>
                        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 text-xs text-[var(--muted)]">
                          <span>{formatDate(job.postedAt ?? job.firstSeenAt)}</span>
                          {job.location ? <span>{job.location}</span> : null}
                          {job.seniority ? <span className="capitalize">{job.seniority}</span> : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap content-start gap-2 lg:justify-end">
                        {remote ? <span className="ledger-tag ledger-tag-signal">{remote}</span> : null}
                        {salary ? <span className="ledger-tag">{salary}</span> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="grid min-h-[420px] place-items-center px-6 py-14 text-center sm:px-10">
                <div className="max-w-sm">
                  <p className="font-mono text-[0.66rem] font-bold uppercase tracking-[0.2em] text-[var(--rust)]">
                    {hasFilters ? "Nothing in this cut" : "The ledger is quiet"}
                  </p>
                  <h3 className="mt-3 font-serif text-3xl tracking-[-0.04em] text-[var(--ink)]">
                    {hasFilters ? "No opening matches these filters." : "Bring in the first board run."}
                  </h3>
                  <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                    {hasFilters
                      ? "Broaden the title or date window, or return to every live board."
                      : "Run discovery and the local worker, then return here to filter the openings it found."}
                  </p>
                  {hasFilters ? (
                    <Link className="ledger-button mt-6 inline-flex items-center justify-center" href="/">
                      Clear filters
                    </Link>
                  ) : (
                    <code className="mt-6 inline-block border border-[var(--ledger-border)] bg-[var(--paper-deep)] px-4 py-3 font-mono text-xs text-[var(--ink)]">
                      pnpm discover:seed && pnpm jobs:fetch
                    </code>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
