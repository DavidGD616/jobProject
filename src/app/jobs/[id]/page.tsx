import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { companies, jobs } from "@/db/schema";
import { getApplicationForJob } from "@/tracking";

import { createApplicationAction } from "../../actions";
import { AppNav } from "../../nav";

export const runtime = "nodejs";

type JobPageProps = { params: Promise<{ id: string }> };

export default async function JobPage({ params }: JobPageProps) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const row = db.select({ job: jobs, company: companies }).from(jobs).innerJoin(companies, eq(jobs.companyId, companies.id)).where(eq(jobs.id, id)).get();
  if (!row) notFound();
  const application = getApplicationForJob(id);
  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-10" id="main-content"><div className="ledger-shell mx-auto max-w-[1100px] overflow-hidden border border-[var(--ledger-border)] bg-[var(--paper)] shadow-[0_24px_80px_rgba(45,35,17,0.12)]"><AppNav /><header className="ledger-masthead px-6 py-8 text-[var(--paper)] sm:px-10"><p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--signal)]">Role detail · {row.company.name}</p><h1 className="mt-3 max-w-4xl font-serif text-4xl leading-[0.94] tracking-[-0.045em] sm:text-5xl">{row.job.title}</h1><p className="mt-4 text-sm text-[color:rgba(255,250,238,0.72)]">{row.job.location ?? "Location not listed"}{row.job.remoteType && row.job.remoteType !== "unknown" ? ` · ${row.job.remoteType}` : ""}</p></header><div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[minmax(0,1fr)_18rem]"><article><div className="flex flex-wrap gap-2">{row.job.seniority ? <span className="ledger-tag">{row.job.seniority}</span> : null}{row.job.salaryMin !== null || row.job.salaryMax !== null ? <span className="ledger-tag">Published compensation</span> : null}</div><div className="mt-7 whitespace-pre-wrap text-sm leading-7 text-[var(--ink-soft)]">{row.job.description}</div></article><aside className="grid content-start gap-5"><a className="ledger-button inline-flex items-center justify-center" href={row.job.url} rel="noreferrer" target="_blank">Open original posting ↗</a>{application ? <div className="border border-[var(--ledger-border)] bg-[var(--paper-deep)] p-4"><p className="ledger-kicker">Application</p><p className="mt-2 text-sm font-bold capitalize text-[var(--ink)]">{application.status}</p><Link className="ledger-text-link mt-3 inline-block" href="/pipeline">Open pipeline</Link></div> : <form action={createApplicationAction} className="border border-[var(--ledger-border)] bg-[var(--paper-deep)] p-4"><input name="job_id" type="hidden" value={row.job.id} /><p className="ledger-kicker">Start tracking</p><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Create a draft. The app will never submit it for you.</p><textarea className="ledger-control mt-3 min-h-20" name="notes" placeholder="Why this role is worth a closer look" /><button className="ledger-button mt-3 w-full" type="submit">Create draft</button></form>}<Link className="ledger-text-link" href="/review">Back to ranked review</Link></aside></div></div></main>
  );
}
