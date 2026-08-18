import Link from "next/link";

import { displayCompanyName, listTailorRequests } from "@/db";
import { listApplications } from "@/tracking";
import { listResumeVariants } from "@/tailor";

import { WorkflowCallout } from "../_components/workflow-callout";
import {
  card,
  dangerTag,
  errorNotice,
  field,
  notice,
  pageHeader,
  positiveTag,
  primaryButton,
  quietButton,
  secondaryButton,
  tag,
  textLink,
  warningTag,
  workspaceShell,
} from "../_components/ui";
import { queueTailorVariantAction, updateCoverLetterAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type TailorPageProps = { searchParams: Promise<{ queued?: string; letter_saved?: string; error?: string }> };

function requestLabel(status: string): string {
  if (status === "completed") return "Ready to review";
  if (status === "failed") return "Needs attention";
  if (status === "running") return "Being prepared";
  return "Ready to prepare";
}

function requestClass(status: string): string {
  if (status === "completed") return positiveTag;
  if (status === "failed") return dangerTag;
  return warningTag;
}

function dateLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

export default async function TailorPage({ searchParams }: TailorPageProps) {
  const applications = listApplications();
  const query = await searchParams;

  return (
    <main className="min-h-screen px-3 py-3 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={workspaceShell}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 5 of 6 · Prepare your materials</p>
              <h1 className="mt-3 max-w-3xl font-serif text-4xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl">Make each application easier to recognize.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] sm:text-base">Create a role-specific resume and cover letter from the facts you have already saved, then review every word before you use it.</p>
            </div>
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--paper)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_8%,transparent)] p-5">
              <p className="text-sm font-semibold text-[var(--paper)]">Your Harvard resume design stays exactly the same.</p>
              <p className="mt-2 text-xs leading-5 text-[color:color-mix(in_srgb,var(--paper)_68%,transparent)]">This process only chooses and rephrases true experience from your profile. It does not invent accomplishments or redesign the document.</p>
            </div>
          </div>
        </header>

        <div className="px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <div aria-live="polite" className="grid gap-3">
            {query.queued ? <p className={notice}>This role is ready for materials preparation. In a local terminal, run <code className="rounded bg-white/60 px-1.5 py-0.5 text-xs">pnpm tailor -- --next</code>, then return here to review the draft.</p> : null}
            {query.letter_saved ? <p className={notice}>Your cover letter edits were saved to the current material set.</p> : null}
            {query.error ? <p className={errorNotice} role="alert">{query.error}</p> : null}
          </div>

          <section aria-labelledby="materials-heading" className="mt-7">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">Your materials</p>
                <h2 className="mt-1 font-serif text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]" id="materials-heading">One role, one focused review.</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Start with a tracked application. Queue it, prepare it locally, then open the PDF and letter to make the final call.</p>
              </div>
              <WorkflowCallout eyebrow="Three simple steps" title="Prepare with intent" tone="signal">
                <ol className="grid gap-1.5 pl-4 text-xs leading-5 marker:font-semibold">
                  <li>Queue a role below.</li>
                  <li>Prepare the next set locally.</li>
                  <li>Read the PDF and edit the letter before using either.</li>
                </ol>
              </WorkflowCallout>
            </div>

            {applications.length > 0 ? (
              <ol className="mt-6 grid gap-5" aria-label="Application materials">
                {applications.map((application) => {
                  const requests = listTailorRequests(application.job.id);
                  const activeRequest = requests.find((request) => request.status === "queued" || request.status === "running");
                  const latestRequest = requests[0];
                  const variants = [...listResumeVariants(application.job.id)].reverse();
                  const latestVariant = variants[0];
                  const olderVariants = variants.slice(1);

                  return (
                    <li key={application.id}>
                      <article className={card}>
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={tag}>{application.status.replace(/\b\w/g, (letter) => letter.toUpperCase())} application</span>
                              {latestVariant ? <span className={positiveTag}>Materials ready</span> : latestRequest ? <span className={requestClass(latestRequest.status)}>{requestLabel(latestRequest.status)}</span> : <span className={tag}>No materials yet</span>}
                            </div>
                            <Link className="mt-3 block font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)] transition hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)]" href={`/jobs/${application.job.id}`}>{application.job.title}</Link>
                            <p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(application.company.name)}</p>
                          </div>
                          <Link className={`${secondaryButton} shrink-0`} href={`/jobs/${application.job.id}`}>Read role</Link>
                        </div>

                        <div className="mt-5 grid gap-5 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.65fr)]">
                          <section aria-label={`Prepare materials for ${application.job.title}`}>
                            <p className="text-sm font-semibold text-[var(--ink)]">What to do next</p>
                            <p className="mt-1.5 max-w-xl text-sm leading-6 text-[var(--ink-soft)]">
                              {activeRequest
                                ? activeRequest.status === "running"
                                  ? "This set is currently being prepared locally. Return here when it is ready to review."
                                  : "This set is waiting to be prepared locally. Run the command below when you are ready."
                                : latestVariant
                                  ? "Open the latest PDF and letter. If both are accurate, move on to form preparation."
                                  : "Queue this role when you want a focused, fact-based first draft."}
                            </p>

                            <div className="mt-5 flex flex-wrap items-center gap-3">
                              {activeRequest ? (
                                <>
                                  <span className={requestClass(activeRequest.status)} aria-live="polite">{requestLabel(activeRequest.status)}</span>
                                  {activeRequest.status === "queued" ? <code className="rounded-lg border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">pnpm tailor -- --next</code> : null}
                                </>
                              ) : (
                                <form action={queueTailorVariantAction}>
                                  <input name="job_id" type="hidden" value={application.job.id} />
                                  <button className={primaryButton} type="submit">Prepare materials</button>
                                </form>
                              )}
                              {latestVariant ? <Link className={`text-sm ${textLink}`} href="/apply">Go to form prep</Link> : null}
                            </div>

                            {latestRequest?.status === "failed" && latestRequest.error ? (
                              <details className="mt-4 rounded-xl border border-[#e2a298] bg-[#fff7f5] p-4">
                                <summary className="cursor-pointer text-sm font-semibold text-[#973e34]">See what needs attention</summary>
                                <p className="mt-2 break-words text-xs leading-5 text-[#973e34]">{latestRequest.error}</p>
                              </details>
                            ) : null}
                          </section>

                          <section className="rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_64%,transparent)] p-4" aria-label={`Latest materials for ${application.job.title}`}>
                            {latestVariant ? (
                              <>
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-xs font-semibold text-[var(--rust)]">Latest material set</p>
                                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Prepared {dateLabel(latestVariant.createdAt)}</p>
                                  </div>
                                  <span className={positiveTag}>Ready</span>
                                </div>
                                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                  <a className={`${primaryButton} w-full`} href={`/api/exports/${latestVariant.id}?format=pdf`}>Open resume PDF</a>
                                  <a className={`${secondaryButton} w-full`} href={`/api/exports/${latestVariant.id}?format=html`}>Open resume HTML</a>
                                </div>
                                <details className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
                                  <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Read or edit the cover letter</summary>
                                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Edit anything that does not sound like you before you use it.</p>
                                  <form action={updateCoverLetterAction} className="mt-3 grid gap-3">
                                    <input name="variant_id" type="hidden" value={latestVariant.id} />
                                    <textarea aria-label={`Cover letter for variant ${latestVariant.id}`} className={`${field} min-h-52 resize-y text-sm leading-6`} defaultValue={latestVariant.coverLetter ?? ""} name="cover_letter" />
                                    <button aria-label="Save cover letter" className={`${quietButton} justify-self-start`} type="submit">Save cover letter</button>
                                  </form>
                                </details>
                              </>
                            ) : (
                              <div className="grid min-h-48 place-items-center text-center">
                                <div>
                                  <p className="text-sm font-semibold text-[var(--ink)]">Nothing to review yet</p>
                                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">The first resume and letter will appear here after local preparation finishes.</p>
                                </div>
                              </div>
                            )}
                          </section>
                        </div>

                        {olderVariants.length > 0 ? (
                          <details className="mt-5 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
                            <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-soft)]">See {olderVariants.length} earlier material set{olderVariants.length === 1 ? "" : "s"}</summary>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                              {olderVariants.map((variant) => (
                                <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_68%,transparent)] p-4" key={variant.id}>
                                  <p className="text-sm font-semibold text-[var(--ink)]">Prepared {dateLabel(variant.createdAt)}</p>
                                  <div className="mt-3 flex flex-wrap gap-3 text-xs">
                                    <a className={textLink} href={`/api/exports/${variant.id}?format=pdf`}>Resume PDF</a>
                                    <a className={textLink} href={`/api/exports/${variant.id}?format=html`}>Resume HTML</a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="mt-6 grid min-h-[360px] place-items-center rounded-3xl border border-dashed border-[color:color-mix(in_srgb,var(--ink)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-6 py-12 text-center">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold text-[var(--rust)]">No saved applications yet</p>
                  <h3 className="mt-2 font-serif text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Choose a role before creating its materials.</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Saving a role creates a draft application. That gives every resume and letter a clear role to serve.</p>
                  <Link className={`${primaryButton} mt-6`} href="/review">Look through my matches</Link>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
