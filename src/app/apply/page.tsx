import Link from "next/link";

import { listApplicationRuns } from "@/apply";
import { displayCompanyName } from "@/db";
import { listApplications } from "@/tracking";

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
  const query = await searchParams;

  return (
    <main className="min-h-screen px-3 py-3 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={workspaceShell}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 6 of 6 · Get the form ready</p>
              <h1 className="mt-3 max-w-3xl font-serif text-4xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl">Prepare carefully. Submit only when you are ready.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] sm:text-base">Build a checklist for the original application form, review every response, answer its custom questions yourself, and make the final submission in your browser.</p>
            </div>
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--paper)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_8%,transparent)] p-5">
              <p className="text-sm font-semibold text-[var(--paper)]">You stay in control of every submission.</p>
              <p className="mt-2 text-xs leading-5 text-[color:color-mix(in_srgb,var(--paper)_68%,transparent)]">This workspace can prepare a review checklist. It does not click Submit, decide answers, or send an application.</p>
            </div>
          </div>
        </header>

        <div className="px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <div aria-live="polite" className="grid gap-3">
            {query.saved ? <p className={notice}>Your form checklist is ready. Open the original posting only after you have reviewed it.</p> : null}
            {query.error ? <p className={errorNotice} role="alert">{query.error}</p> : null}
          </div>

          <section aria-labelledby="form-prep-heading" className="mt-7">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">Form preparation</p>
                <h2 className="mt-1 font-serif text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]" id="form-prep-heading">A clear checklist for the final human step.</h2>
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
                  return (
                    <li key={application.id}>
                      <article className={card}>
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2"><span className={tag}>{readableStatus(application.status)} application</span>{latestRun ? <span className={positiveTag}>Checklist ready</span> : <span className={tag}>No checklist yet</span>}</div>
                            <Link className="mt-3 block font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)] transition hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)]" href={`/jobs/${application.job.id}`}>{application.job.title}</Link>
                            <p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(application.company.name)}</p>
                          </div>
                          <a className={`${secondaryButton} shrink-0`} href={application.job.url} rel="noreferrer" target="_blank">Open official form ↗</a>
                        </div>

                        <div className="mt-5 flex flex-col gap-3 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-5 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-[var(--ink)]">{latestRun ? "Refresh the checklist if your details changed" : "Start by building a form checklist"}</p>
                            <p className="mt-1 text-xs leading-5 text-[var(--muted)]">It lists known fields and flags anything the application still needs from you.</p>
                          </div>
                          <form action={prepareApplicationAction}>
                            <input name="application_id" type="hidden" value={application.id} />
                            <button className={primaryButton} type="submit">{latestRun ? "Refresh checklist" : "Build checklist"}</button>
                          </form>
                        </div>

                        {visibleRuns.length > 0 ? (
                          <div className="mt-5 grid gap-4">
                            {visibleRuns.map((run, runIndex) => {
                              const plan = planFromRun(run);
                              const fields = plan.fields ?? [];
                              const instructions = plan.instructions ?? [];
                              const customQuestions = plan.customQuestions ?? [];
                              return (
                                <section className="rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_65%,transparent)] p-4 sm:p-5" key={run.id}>
                                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <p className="text-sm font-semibold text-[var(--ink)]">{runIndex === 0 ? "Current checklist" : "Previous checklist"}</p>
                                      <p className="mt-0.5 text-xs text-[var(--muted)]">Prepared {dateLabel(run.finishedAt ?? run.startedAt)}</p>
                                    </div>
                                    <span className={positiveTag}>Review before submitting</span>
                                  </div>

                                  <div className="mt-5 grid gap-2" aria-label="Suggested form values">
                                    {fields.length > 0 ? fields.map((item) => (
                                      <div className="grid gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_9%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_76%,transparent)] px-3 py-3 sm:grid-cols-[minmax(9rem,0.4fr)_minmax(0,1fr)] sm:items-start" key={`${item.label}-${item.source}`}>
                                        <p className="text-xs font-semibold text-[var(--ink-soft)]">{item.label}{item.required ? <span className="text-[var(--rust)]"> · Required</span> : null}</p>
                                        <p className={`break-words text-xs leading-5 ${item.value ? "text-[var(--ink)]" : "font-semibold text-[var(--rust)]"}`}>{item.value || "You need to complete this yourself"}</p>
                                      </div>
                                    )) : <p className="rounded-xl bg-[color:color-mix(in_srgb,var(--rust)_6%,transparent)] px-4 py-3 text-sm leading-6 text-[var(--ink-soft)]">This form did not expose a standard field list. Open the official form and review it yourself.</p>}
                                  </div>

                                  {(instructions.length > 0 || customQuestions.length > 0) ? (
                                    <div className="mt-5 grid gap-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4 lg:grid-cols-2">
                                      {instructions.length > 0 ? <div><p className="text-xs font-semibold text-[var(--ink)]">Keep in mind</p><ul className="mt-2 grid gap-1.5 text-xs leading-5 text-[var(--ink-soft)]">{instructions.map((instruction) => <li className="flex gap-2" key={instruction}><span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--rust)]" />{instruction}</li>)}</ul></div> : null}
                                      {customQuestions.length > 0 ? <div className="rounded-xl border border-[#d9b85d] bg-[#fff9e5] px-4 py-3"><p className="text-xs font-semibold text-[#795b08]">Answer these yourself</p><ul className="mt-2 grid gap-1.5 text-xs leading-5 text-[#624e10]">{customQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div> : null}
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
              <div className="mt-6 grid min-h-[360px] place-items-center rounded-3xl border border-dashed border-[color:color-mix(in_srgb,var(--ink)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-6 py-12 text-center">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold text-[var(--rust)]">No saved applications yet</p>
                  <h3 className="mt-2 font-serif text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Start by choosing a role you genuinely want to pursue.</h3>
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
