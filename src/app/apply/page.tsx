import Link from "next/link";

import { displayCompanyName } from "@/db";
import { listApplications } from "@/tracking";
import { listApplicationRuns } from "@/apply";

import { prepareApplicationAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type ApplyPageProps = { searchParams: Promise<{ saved?: string; error?: string }> };

type StoredPlan = { adapter?: string; url?: string; submissionBlocked?: true; fields?: Array<{ label: string; value: string | null; required: boolean; source: string }>; instructions?: string[]; customQuestions?: string[] };

function planFromRun(run: { fields: unknown }): StoredPlan {
  return (run.fields && typeof run.fields === "object" ? run.fields : {}) as StoredPlan;
}

export default async function ApplyPage({ searchParams }: ApplyPageProps) {
  const applications = listApplications();
  const query = await searchParams;
  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-10" id="main-content"><div className="ledger-shell mx-auto max-w-[1320px] overflow-hidden border border-[var(--ledger-border)] bg-[var(--paper)] shadow-[0_24px_80px_rgba(45,35,17,0.12)]"><AppNav /><header className="ledger-masthead px-6 py-8 text-[var(--paper)] sm:px-10"><p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--signal)]">Assisted apply</p><h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.94] tracking-[-0.045em] sm:text-5xl">Prepare the form. Keep the decision human.</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-[color:rgba(255,250,238,0.72)]">ATS-specific field plans make the brittle parts inspectable. This screen never submits, clicks Submit, or answers custom questions.</p></header><div className="px-6 py-8 sm:px-10">{query.saved ? <p className="ledger-notice mb-5" role="status">A review plan was prepared. Open the original URL and complete the final review yourself.</p> : null}{query.error ? <p className="ledger-error mb-5" role="alert">{query.error}</p> : null}{applications.length > 0 ? <div className="grid gap-6">{applications.map((application) => { const runs = listApplicationRuns(application.id); return <article className="border border-[var(--ledger-border)] bg-[var(--paper-deep)] p-5" key={application.id}><div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="font-serif text-2xl tracking-[-0.035em] text-[var(--ink)] hover:text-[var(--rust)]" href={`/jobs/${application.job.id}`}>{application.job.title}</Link><p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(application.company.name)}</p></div><span className="ledger-tag capitalize">{application.status}</span></div><div className="mt-5 flex flex-wrap items-center gap-3"><form action={prepareApplicationAction}><input name="application_id" type="hidden" value={application.id} /><button className="ledger-button" type="submit">Prepare review plan</button></form><a className="ledger-text-link" href={application.job.url} rel="noreferrer" target="_blank">Open original ↗</a></div>{runs.length > 0 ? <div className="mt-5 grid gap-4">{runs.slice(-2).reverse().map((run) => { const plan = planFromRun(run); return <section className="border border-[var(--ledger-border)] bg-[var(--paper)] p-4" key={run.id}><div className="flex flex-wrap justify-between gap-2"><p className="ledger-kicker">Run {run.id} · {plan.adapter ?? run.adapter}</p><span className="ledger-tag ledger-tag-signal">Submission blocked</span></div><div className="mt-4 grid gap-2">{(plan.fields ?? []).map((field) => <div className="grid gap-1 border-b border-[var(--ledger-border)] pb-2 sm:grid-cols-[10rem_minmax(0,1fr)]" key={field.label}><span className="text-xs font-bold text-[var(--muted)]">{field.label}{field.required ? " *" : ""}</span><span className="break-words text-xs text-[var(--ink-soft)]">{field.value || "Review / complete manually"}</span></div>)}</div><div className="mt-4 grid gap-2"><p className="ledger-kicker">Before you submit</p>{(plan.instructions ?? []).map((instruction) => <p className="text-xs leading-5 text-[var(--ink-soft)]" key={instruction}>• {instruction}</p>)}{(plan.customQuestions ?? []).map((question) => <p className="text-xs font-bold leading-5 text-[var(--rust)]" key={question}>{question}</p>)}</div></section>; })}</div> : <p className="mt-5 text-sm leading-6 text-[var(--muted)]">No preparation run yet. Create one to inspect the field plan.</p>}</article>; })}</div> : <div className="grid min-h-[340px] place-items-center border border-dashed border-[var(--ledger-border)] p-8 text-center"><div><p className="ledger-kicker">No tracked applications</p><h2 className="mt-2 font-serif text-3xl tracking-[-0.04em]">Start in the pipeline.</h2><Link className="ledger-button mt-5 inline-flex" href="/pipeline">Open pipeline</Link></div></div>}</div></div></main>
  );
}
