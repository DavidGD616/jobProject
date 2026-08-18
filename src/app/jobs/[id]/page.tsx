import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { db, displayCompanyName } from "@/db";
import { companies, jobs } from "@/db/schema";
import { getApplicationForJob } from "@/tracking";

import {
  card,
  field,
  notice,
  pageHeader,
  positiveTag,
  primaryButton,
  secondaryButton,
  tag,
  textLink,
  workspaceShell,
} from "../../_components/ui";
import { createApplicationAction } from "../../actions";
import { AppNav } from "../../nav";

export const runtime = "nodejs";

type JobPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ interested?: string }> };

function readableStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function salaryLabel(input: { min: number | null; max: number | null; currency: string | null; period: string | null }): string | null {
  if (input.min === null && input.max === null) return null;
  const formatter = input.currency
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: input.currency, maximumFractionDigits: 0 })
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const amount = input.min !== null && input.max !== null
    ? `${formatter.format(input.min)}–${formatter.format(input.max)}`
    : formatter.format(input.min ?? input.max ?? 0);
  return input.period ? `${amount} / ${input.period}` : amount;
}

export default async function JobPage({ params, searchParams }: JobPageProps) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const query = await searchParams;
  const row = db.select({ job: jobs, company: companies }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, id)).get();
  if (!row) notFound();
  const application = getApplicationForJob(id);
  const companyName = displayCompanyName(row.company.name);
  const salary = salaryLabel({ min: row.job.salaryMin, max: row.job.salaryMax, currency: row.job.currency, period: row.job.salaryPeriod });

  return (
    <main className="min-h-screen px-3 py-3 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={`${workspaceShell} max-w-[1240px]`}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-end">
            <div>
              <Link className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] underline decoration-[color:color-mix(in_srgb,var(--paper)_34%,transparent)] underline-offset-4 transition hover:text-[var(--paper)]" href="/">← Back to open roles</Link>
              <p className="mt-5 text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 2 of 6 · Explore a role · {companyName}</p>
              <h1 className="mt-2 max-w-4xl break-words font-serif text-[2.1rem] font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl">{row.job.title}</h1>
              <p className="mt-4 text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">{row.job.location ?? "Location not listed"}{row.job.remoteType && row.job.remoteType !== "unknown" ? ` · ${row.job.remoteType}` : ""}</p>
            </div>
            <a className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[var(--paper)] px-4 py-2.5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[color:color-mix(in_srgb,var(--paper)_86%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--paper)] lg:w-auto" href={row.job.url} rel="noreferrer" target="_blank">Open official posting ↗</a>
          </div>
        </header>

        <div className="px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          {query.interested ? <p className={notice} role="status">Saved to your shortlist. Read the role, then create a draft only if you want to follow through.</p> : null}

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <article aria-labelledby="description-heading" className="min-w-0">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-semibold text-[var(--rust)]">The role</p>
                  <h2 className="mt-1 font-serif text-[1.75rem] font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-3xl" id="description-heading">Read the details before you commit.</h2>
                </div>
                <span className={tag}>Official company posting</span>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {row.job.location ? <span className={tag}>{row.job.location}</span> : null}
                {row.job.remoteType && row.job.remoteType !== "unknown" ? <span className={positiveTag}>{row.job.remoteType}</span> : null}
                {row.job.seniority ? <span className={tag}>{row.job.seniority}</span> : null}
                {salary ? <span className={tag}>{salary}</span> : null}
              </div>

              <div className="mt-6 break-words whitespace-pre-wrap rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] p-5 text-sm leading-7 text-[var(--ink-soft)] sm:p-7">
                {row.job.description}
              </div>
            </article>

            <aside className="grid content-start gap-4" aria-label="Next steps for this role">
              {application ? (
                <section className={card}>
                  <p className="text-sm font-semibold text-[var(--rust)]">You are tracking this role</p>
                  <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]">Keep the next step visible.</h2>
                  <div className="mt-4 flex flex-wrap gap-2"><span className={positiveTag}>{readableStatus(application.status)}</span>{application.nextFollowupAt ? <span className={tag}>Follow up {application.nextFollowupAt.toISOString().slice(0, 10)}</span> : null}</div>
                  <p className="mt-4 text-sm leading-6 text-[var(--muted)]">{application.notes || "Update this application as your conversations and next steps change."}</p>
                  <div className="mt-5 grid gap-2">
                    <Link className={`${primaryButton} w-full`} href="/pipeline">Open applications</Link>
                    <Link className={`${secondaryButton} w-full`} href="/tailor">Prepare materials</Link>
                    <Link className={`${secondaryButton} w-full`} href="/apply">Open form prep</Link>
                  </div>
                </section>
              ) : (
                <section className={card}>
                  <p className="text-sm font-semibold text-[var(--rust)]">If this feels promising</p>
                  <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]">Save it as a private draft.</h2>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted)]">A draft is just a record in your Applications page. It does not contact the company or submit anything.</p>
                  <form action={createApplicationAction} className="mt-5 grid gap-4">
                    <input name="job_id" type="hidden" value={row.job.id} />
                    <label className="text-sm font-semibold text-[var(--ink)]">
                      Why is this worth a closer look? <span className="font-normal text-[var(--muted)]">(optional)</span>
                      <textarea className={`${field} min-h-28 resize-y`} name="notes" placeholder="For example: Strong platform fit; ask about team scope" />
                    </label>
                    <button className={`${primaryButton} w-full`} type="submit">Save as a draft</button>
                  </form>
                </section>
              )}

              <section className="rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_62%,transparent)] p-5">
                <p className="text-sm font-semibold text-[var(--ink)]">A quick reminder</p>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">A good match is a reason to investigate, not a guarantee. Use the original posting to check the work, requirements, and application deadline yourself.</p>
                <a className={`mt-4 inline-block text-sm ${textLink}`} href={row.job.url} rel="noreferrer" target="_blank">Read the original posting ↗</a>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
