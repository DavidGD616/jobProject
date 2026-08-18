import Link from "next/link";

import {
  isApplicationRunStale,
  listApplicationRuns,
  type ApplicationMaterialSnapshot,
} from "@/apply";
import { displayCompanyName } from "@/db";
import { ensureActiveProfile } from "@/matching";
import { listApplications } from "@/tracking";
import { listResumeVariants } from "@/tailor";

import { WorkflowCallout } from "../_components/workflow-callout";
import {
  card,
  errorNotice,
  notice,
  pageHeader,
  positiveTag,
  primaryButton,
  secondaryButton,
  tag,
  warningTag,
  workspaceShell,
} from "../_components/ui";
import { prepareApplicationAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type ApplyPageProps = { searchParams: Promise<{ saved?: string; error?: string }> };

type StoredPlan = {
  adapter?: string;
  url?: string;
  submissionBlocked?: true;
  fields?: Array<{ label: string; value: string | null; required: boolean; source: string }>;
  instructions?: string[];
  customQuestions?: string[];
  materialSnapshot?: ApplicationMaterialSnapshot;
};

function planFromRun(run: { fields: unknown }): StoredPlan {
  return (run.fields && typeof run.fields === "object" ? run.fields : {}) as StoredPlan;
}

function dateLabel(value: Date | null): string {
  if (!value) return "just now";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(value);
}

function readableStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function ApplyPage({ searchParams }: ApplyPageProps) {
  const applications = listApplications();
  const profile = ensureActiveProfile();
  const query = await searchParams;

  return (
    <main className="min-h-screen px-2 py-2 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={workspaceShell}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 6 of 6 · Get the form ready</p>
              <h1 className="mt-3 max-w-3xl font-serif text-[2rem] font-semibold leading-[1.02] tracking-[-0.05em] min-[380px]:text-4xl sm:text-5xl">Prepare carefully. Submit only when you are ready.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] sm:text-base">Build a checklist for the original application form, review every response, answer its custom questions yourself, and make the final submission in your browser.</p>
            </div>
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--paper)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_8%,transparent)] p-4 sm:p-5">
              <p className="text-sm font-semibold text-[var(--paper)]">You stay in control of every submission.</p>
              <p className="mt-2 text-xs leading-5 text-[color:color-mix(in_srgb,var(--paper)_68%,transparent)]">This workspace can prepare a review checklist. It does not click Submit, decide answers, or send an application.</p>
            </div>
          </div>
        </header>

        <div className="px-4 py-6 sm:px-8 sm:py-7 lg:px-10 lg:py-9">
          <div aria-live="polite" className="grid gap-3">
            {query.saved ? <p className={notice}>Your form checklist is ready. Open the original posting only after you have reviewed it.</p> : null}
            {query.error ? <p className={errorNotice} role="alert">{query.error}</p> : null}
          </div>

          <section aria-labelledby="form-prep-heading" className="mt-7">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">Form preparation</p>
                <h2 className="mt-1 font-serif text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--ink)] sm:text-3xl" id="form-prep-heading">A clear checklist for the final human step.</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Use the checklist as a starting point, not a substitute for reading the actual form and application questions.</p>
              </div>
              <WorkflowCallout eyebrow="Before you submit" title="Three things to verify" tone="signal">
                <ol className="grid gap-1.5 pl-4 text-xs leading-5 marker:font-semibold">
                  <li>Your resume and letter are accurate.</li>
                  <li>Every required answer is true and complete.</li>
                  <li>You are on the official application page.</li>
                </ol>
              </WorkflowCallout>
            </div>

            {applications.length > 0 ? (
              <ol className="mt-6 grid gap-5" aria-label="Application form checklists">
                {applications.map((application) => {
                  const runs = listApplicationRuns(application.id);
                  const visibleRuns = runs.slice(-2).reverse();
                  const latestRun = visibleRuns[0];
                  const currentVariant = application.resumeVariantId === null
                    ? null
                    : listResumeVariants(application.job.id).find((variant) => variant.id === application.resumeVariantId) ?? null;
                  const latestRunIsStale = latestRun
                    ? isApplicationRunStale(latestRun, currentVariant, application.job, profile)
                    : false;
                  return (
                    <li key={application.id}>
                      <article className={card}>
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2"><span className={tag}>{readableStatus(application.status)} application</span>{latestRun ? <span className={latestRunIsStale ? warningTag : positiveTag}>{latestRunIsStale ? "Checklist needs refresh" : "Checklist ready"}</span> : <span className={tag}>No checklist yet</span>}</div>
                            <Link className="mt-3 block break-words font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)] transition hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)]" href={`/jobs/${application.job.id}`}>{application.job.title}</Link>
                            <p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(application.company.name)}</p>
                          </div>
                          <a className={`${secondaryButton} w-full shrink-0 sm:w-auto`} href={application.job.url} rel="noreferrer" target="_blank">Open official form ↗</a>
                        </div>

                        <div className="mt-5 flex flex-col gap-3 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--ink)]">{latestRun ? latestRunIsStale ? "Refresh this stale checklist before using it" : "Refresh the checklist if your details changed" : "Start by building a form checklist"}</p>
                            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{latestRunIsStale ? "Its attached materials, source job details, or profile no longer match the saved preparation record." : "It lists known fields and flags anything the application still needs from you."}</p>
                          </div>
                          <form action={prepareApplicationAction} className="w-full sm:w-auto">
                            <input name="application_id" type="hidden" value={application.id} />
                            <button className={`${primaryButton} w-full sm:w-auto`} type="submit">{latestRun ? latestRunIsStale ? "Refresh checklist now" : "Refresh checklist" : "Build checklist"}</button>
                          </form>
                        </div>

                        {visibleRuns.length > 0 ? (
                          <div className="mt-5 grid gap-4">
                            {visibleRuns.map((run, runIndex) => {
                              const plan = planFromRun(run);
                              const fields = plan.fields ?? [];
                              const instructions = plan.instructions ?? [];
                              const customQuestions = plan.customQuestions ?? [];
                              const runIsStale = runIndex === 0 && latestRunIsStale;
                              return (
                                <section className="rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_65%,transparent)] p-4 sm:p-5" key={run.id}>
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <p className="text-sm font-semibold text-[var(--ink)]">{runIndex === 0 ? runIsStale ? "Current checklist — refresh required" : "Current checklist" : "Previous checklist"}</p>
                                      <p className="mt-0.5 text-xs text-[var(--muted)]">Prepared {dateLabel(run.finishedAt ?? run.startedAt)}</p>
                                    </div>
                                    <span className={`${runIsStale ? warningTag : positiveTag} self-start sm:self-auto`}>{runIsStale ? "Out of date" : "Review before submitting"}</span>
                                  </div>

                                  {runIsStale ? (
                                    <div className="mt-4 rounded-xl border border-[#d9b85d] bg-[#fff9e5] px-4 py-3 text-sm leading-6 text-[#624e10]" role="alert">
                                      <p className="font-semibold">Refresh this checklist before you copy any answers into the application form.</p>
                                      <p className="mt-1 text-xs leading-5">{plan.materialSnapshot ? "A newer resume or letter, job description, or profile version no longer matches the checklist you are viewing." : "This older checklist did not record a material snapshot, so it cannot be verified against your current resume, job description, and profile."}</p>
                                    </div>
                                  ) : null}

                                  <div className="mt-5 grid gap-2" aria-label="Suggested form values">
                                    {fields.length > 0 ? fields.map((item) => (
                                      <div className="grid min-w-0 gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_9%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_76%,transparent)] px-3 py-3 sm:grid-cols-[minmax(9rem,0.4fr)_minmax(0,1fr)] sm:items-start" key={`${item.label}-${item.source}`}>
                                        <p className="break-words text-xs font-semibold text-[var(--ink-soft)]">{item.label}{item.required ? <span className="text-[var(--rust)]"> · Required</span> : null}</p>
                                        <p className={`min-w-0 break-words text-xs leading-5 ${item.value ? "text-[var(--ink)]" : "font-semibold text-[var(--rust)]"}`}>{item.value || "You need to complete this yourself"}</p>
                                      </div>
                                    )) : <p className="rounded-xl bg-[color:color-mix(in_srgb,var(--rust)_6%,transparent)] px-4 py-3 text-sm leading-6 text-[var(--ink-soft)]">This form did not expose a standard field list. Open the official form and review it yourself.</p>}
                                  </div>

                                  {(instructions.length > 0 || customQuestions.length > 0) ? (
                                    <div className="mt-5 grid gap-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4 lg:grid-cols-2">
                                      {instructions.length > 0 ? <div className="min-w-0"><p className="text-xs font-semibold text-[var(--ink)]">Keep in mind</p><ul className="mt-2 grid gap-1.5 text-xs leading-5 text-[var(--ink-soft)]">{instructions.map((instruction) => <li className="flex min-w-0 gap-2" key={instruction}><span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--rust)]" /><span className="min-w-0 break-words">{instruction}</span></li>)}</ul></div> : null}
                                      {customQuestions.length > 0 ? <div className="min-w-0 rounded-xl border border-[#d9b85d] bg-[#fff9e5] px-4 py-3"><p className="text-xs font-semibold text-[#795b08]">Answer these yourself</p><ul className="mt-2 grid gap-1.5 text-xs leading-5 text-[#624e10]">{customQuestions.map((question) => <li className="break-words" key={question}>{question}</li>)}</ul></div> : null}
                                    </div>
                                  ) : null}
                                </section>
                              );
                            })}
                          </div>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="mt-6 grid min-h-[320px] place-items-center rounded-3xl border border-dashed border-[color:color-mix(in_srgb,var(--ink)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-5 py-10 text-center sm:min-h-[360px] sm:px-6 sm:py-12">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold text-[var(--rust)]">No saved applications yet</p>
                  <h3 className="mt-2 font-serif text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--ink)] sm:text-3xl">Start by choosing a role you genuinely want to pursue.</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Save it as a draft from your Matches page. Then prepare the materials and form with a clear record of each step.</p>
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
