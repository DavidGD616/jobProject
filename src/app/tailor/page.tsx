import Link from "next/link";

import { displayCompanyName, listTailorRequests } from "@/db";
import { listApplications } from "@/tracking";
import { listResumeVariants } from "@/tailor";

import { queueTailorVariantAction, updateCoverLetterAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type TailorPageProps = { searchParams: Promise<{ queued?: string; letter_saved?: string; error?: string }> };

function requestLabel(status: string): string {
  return status === "completed" ? "Export ready" : status === "failed" ? "Needs attention" : status === "running" ? "Rendering locally" : "Queued locally";
}

function requestClass(status: string): string {
  if (status === "completed") return "ledger-tag ledger-tag-signal";
  if (status === "failed") return "ledger-tag ledger-tag-danger";
  return "ledger-tag ledger-tag-pending";
}

function dateLabel(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function TailorPage({ searchParams }: TailorPageProps) {
  const applications = listApplications();
  const query = await searchParams;

  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-10" id="main-content">
      <div className="ledger-shell mx-auto max-w-[1320px] overflow-hidden border border-[var(--ledger-border)] bg-[var(--paper)] shadow-[0_24px_80px_rgba(45,35,17,0.12)]">
        <AppNav />
        <header className="ledger-masthead px-6 py-8 text-[var(--paper)] sm:px-10">
          <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-end">
            <div>
              <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--signal)]">Tailoring desk</p>
              <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.94] tracking-[-0.045em] sm:text-5xl">Make the facts easier to find.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:rgba(255,250,238,0.72)]">Queue a role here; the local worker produces the grounded, reviewable export. Your Harvard resume layout stays exactly as it is.</p>
            </div>
            <div className="border-l border-[color:rgba(255,250,238,0.22)] pl-5 text-sm leading-6 text-[color:rgba(255,250,238,0.72)]">
              <p className="font-mono text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[var(--signal)]">Local handoff</p>
              <code className="mt-2 block border border-[color:rgba(255,250,238,0.26)] bg-black/10 px-3 py-2 text-xs text-[var(--paper)]">pnpm tailor -- --next</code>
            </div>
          </div>
        </header>

        <div className="px-6 py-8 sm:px-10">
          {query.queued ? <p className="ledger-notice mb-5" role="status">Tailoring is queued. Run <code>pnpm tailor -- --next</code> in a local terminal to produce the draft and export.</p> : null}
          {query.letter_saved ? <p className="ledger-notice mb-5" role="status">Cover-letter edits were saved to the current variant.</p> : null}
          {query.error ? <p className="ledger-error mb-5" role="alert">{query.error}</p> : null}

          {applications.length > 0 ? (
            <div className="grid gap-5">
              {applications.map((application) => {
                const requests = listTailorRequests(application.job.id);
                const activeRequest = requests.find((request) => request.status === "queued" || request.status === "running");
                const latestRequest = requests[0];
                const variants = [...listResumeVariants(application.job.id)].reverse();
                const latestVariant = variants[0];
                const olderVariants = variants.slice(1);

                return (
                  <article className="border border-[var(--ledger-border)] bg-[var(--paper-deep)] p-5 sm:p-6" key={application.id}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="ledger-kicker">Role packet</p>
                        <Link className="mt-2 block font-serif text-2xl tracking-[-0.035em] text-[var(--ink)] transition-colors hover:text-[var(--rust)]" href={`/jobs/${application.job.id}`}>{application.job.title}</Link>
                        <p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(application.company.name)}</p>
                      </div>
                      <span className="ledger-tag capitalize">{application.status}</span>
                    </div>

                    <div className="mt-5 grid gap-4 border-t border-[var(--ledger-border)] pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,0.56fr)]">
                      <div>
                        <p className="text-sm leading-6 text-[var(--ink-soft)]">The worker selects and renders only facts from your stored profile. It never submits an application or changes the resume template.</p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          {activeRequest ? (
                            <span className={requestClass(activeRequest.status)} aria-live="polite">{requestLabel(activeRequest.status)}</span>
                          ) : (
                            <form action={queueTailorVariantAction}>
                              <input name="job_id" type="hidden" value={application.job.id} />
                              <button className="ledger-button" type="submit">Queue tailored variant</button>
                            </form>
                          )}
                          {activeRequest ? <code className="text-xs text-[var(--muted)]">pnpm tailor -- --next</code> : null}
                          {latestRequest && !activeRequest ? <span className={requestClass(latestRequest.status)}>{requestLabel(latestRequest.status)}</span> : null}
                        </div>
                        {latestRequest?.status === "failed" && latestRequest.error ? <p className="mt-3 text-xs leading-5 text-[var(--rust)]">Last worker error: {latestRequest.error}</p> : null}
                      </div>

                      <div className="border border-[var(--ledger-border)] bg-[var(--paper)] p-4">
                        {latestVariant ? (
                          <>
                            <div className="flex items-start justify-between gap-3"><div><p className="ledger-kicker">Latest export</p><p className="mt-2 text-sm font-bold text-[var(--ink)]">Variant {latestVariant.id}</p></div><p className="font-mono text-[0.62rem] uppercase tracking-[0.1em] text-[var(--muted)]">{dateLabel(latestVariant.createdAt)}</p></div>
                            <div className="mt-4 flex flex-wrap gap-3 text-xs font-bold"><a className="ledger-text-link" href={`/api/exports/${latestVariant.id}?format=pdf`}>Open PDF</a><a className="ledger-text-link" href={`/api/exports/${latestVariant.id}?format=html`}>Open HTML</a></div>
                            <details className="mt-4 border-t border-[var(--ledger-border)] pt-3"><summary className="cursor-pointer text-xs font-bold text-[var(--ink-soft)]">Review or edit cover letter</summary><form action={updateCoverLetterAction} className="mt-3 grid gap-3"><input name="variant_id" type="hidden" value={latestVariant.id} /><textarea aria-label={`Cover letter for variant ${latestVariant.id}`} className="ledger-control min-h-44 text-xs leading-5" defaultValue={latestVariant.coverLetter ?? ""} name="cover_letter" /><button className="ledger-action justify-self-start" type="submit">Save letter</button></form></details>
                          </>
                        ) : <p className="text-sm leading-6 text-[var(--muted)]">No export yet. Queue the role, then let the local worker create the first draft.</p>}
                      </div>
                    </div>

                    {olderVariants.length > 0 ? <details className="mt-5 border-t border-[var(--ledger-border)] pt-4"><summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.1em] text-[var(--ink-soft)]">{olderVariants.length} earlier export{olderVariants.length === 1 ? "" : "s"}</summary><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{olderVariants.map((variant) => <div className="border border-[var(--ledger-border)] bg-[var(--paper)] p-4" key={variant.id}><p className="ledger-kicker">Variant {variant.id}</p><p className="mt-2 text-xs text-[var(--muted)]">Created {dateLabel(variant.createdAt)}</p><div className="mt-3 flex flex-wrap gap-3 text-xs font-bold"><a className="ledger-text-link" href={`/api/exports/${variant.id}?format=pdf`}>PDF</a><a className="ledger-text-link" href={`/api/exports/${variant.id}?format=html`}>HTML</a></div></div>)}</div></details> : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-[350px] place-items-center border border-dashed border-[var(--ledger-border)] p-8 text-center">
              <div className="max-w-lg">
                <p className="ledger-kicker">No tracked roles</p>
                <h2 className="mt-2 font-serif text-3xl tracking-[-0.04em]">Create a draft application first.</h2>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">The tailoring desk only creates variants for roles you chose to track, so every export has a clear destination.</p>
                <Link className="ledger-button mt-5 inline-flex" href="/pipeline">Open pipeline</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
