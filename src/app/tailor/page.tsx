import Link from "next/link";

import {
  displayCompanyName,
  listTailorRequests,
  type Job,
  type Profile,
  type ResumeVariant,
  type TailorFitAssessment,
  type TailoringEvidence,
} from "@/db";
import { ensureActiveProfile } from "@/matching";
import { listApplications } from "@/tracking";
import { listResumeVariants } from "@/tailor";

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

type MaterialFreshness = {
  profile: "current" | "changed" | "not_recorded";
  job: "current" | "changed" | "not_recorded";
};

function materialFreshness(variant: ResumeVariant, job: Job, profile: Profile): MaterialFreshness {
  return {
    profile: variant.profileVersion === null
      ? "not_recorded"
      : variant.profileVersion === profile.version
        ? "current"
        : "changed",
    job: variant.jobContentHash === null
      ? "not_recorded"
      : variant.jobContentHash === job.contentHash
        ? "current"
        : "changed",
  };
}

function materialNeedsRefresh(freshness: MaterialFreshness): boolean {
  return freshness.profile === "changed" || freshness.job === "changed";
}

function materialReadiness(fit: TailorFitAssessment | null, freshness: MaterialFreshness): { label: string; className: string } {
  if (materialNeedsRefresh(freshness)) return { label: "Update available", className: warningTag };
  if (fit?.level === "low" || fit?.level === "caution") return { label: "Review requirements", className: warningTag };
  if (fit?.level === "strong") return { label: "Ready to review", className: positiveTag };
  return { label: "Review resume", className: tag };
}

function evidenceSourceLabel(source: TailoringEvidence["source"]): string {
  if (source === "experience") return "Work history";
  if (source === "project") return "Project";
  return "Skill";
}

function ResumeDetails({ variant, job, profile }: { variant: ResumeVariant; job: Job; profile: Profile }) {
  const freshness = materialFreshness(variant, job, profile);
  const needsRefresh = materialNeedsRefresh(freshness);
  const fit = variant.fitAssessment;
  const evidence = variant.evidenceMap ?? [];
  const hasRequirementsToReview = fit?.level === "caution" || fit?.level === "low";

  return (
    <details className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--ink)] marker:hidden">
        <span>Resume details</span>
        <span className="text-xs font-semibold text-[var(--rust)]">View</span>
      </summary>
      <div className="mt-4 grid gap-4 rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] bg-[color:color-mix(in_srgb,var(--rust)_3%,transparent)] p-4">
        {needsRefresh ? (
          <p className="rounded-lg border border-[#d9b85d] bg-[#fff9e5] px-3 py-2 text-xs leading-5 text-[#624e10]">
            Your profile or this role changed after this resume was prepared. Create an updated version before using it.
          </p>
        ) : null}
        {fit?.summary ? <p className="text-sm leading-6 text-[var(--ink-soft)]">{fit.summary}</p> : null}

        {evidence.length > 0 ? (
          <div>
            <p className="text-xs font-semibold text-[var(--ink)]">Selected from your profile</p>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {evidence.map((item, index) => (
                <li className="min-w-0 rounded-lg border border-[color:color-mix(in_srgb,var(--ink)_8%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] px-3 py-2.5" key={`${item.requirement}-${item.source}-${item.label}-${index}`}>
                  <p className="break-words text-xs font-semibold leading-5 text-[var(--ink)]">{item.requirement}</p>
                  <p className="mt-1 break-words text-xs leading-5 text-[var(--muted)]"><span className="font-semibold text-[var(--rust)]">{evidenceSourceLabel(item.source)}</span> · {item.label}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {hasRequirementsToReview && fit?.gaps.length ? (
          <div className="border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-3">
            <p className="text-xs font-semibold text-[var(--ink)]">Requirements to verify</p>
            <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-[var(--ink-soft)]">
              {fit.gaps.map((gap) => <li className="flex gap-2" key={gap}><span aria-hidden="true" className="mt-2 size-1 shrink-0 rounded-full bg-[var(--rust)]" />{gap}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export default async function TailorPage({ searchParams }: TailorPageProps) {
  const applications = listApplications();
  const profile = ensureActiveProfile();
  const query = await searchParams;

  return (
    <main className="min-h-screen px-2 py-2 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={workspaceShell}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative max-w-3xl">
            <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 5 of 6 · Materials</p>
            <h1 className="mt-3 font-serif text-[2rem] font-semibold leading-[1.02] tracking-[-0.05em] min-[380px]:text-4xl sm:text-5xl">Your tailored resumes.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] sm:text-base">One focused resume and cover letter for each saved role.</p>
          </div>
        </header>

        <div className="px-4 py-6 sm:px-8 sm:py-7 lg:px-10 lg:py-9">
          <div aria-live="polite" className="grid gap-3">
            {query.queued ? <p className={notice}>This role is ready for materials preparation. In a local terminal, run <code className="rounded bg-white/60 px-1.5 py-0.5 text-xs">pnpm tailor -- --next</code>, then return here to review the draft.</p> : null}
            {query.letter_saved ? <p className={notice}>Your cover letter edits were saved to the current material set.</p> : null}
            {query.error ? <p className={errorNotice} role="alert">{query.error}</p> : null}
          </div>

          <section aria-labelledby="materials-heading" className="mt-7">
            <div className="flex flex-col gap-4 border-b border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">Materials</p>
                <h2 className="mt-1 font-serif text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--ink)] sm:text-3xl" id="materials-heading">Your saved applications.</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Open the latest resume, make any final edits, then continue to the application.</p>
              </div>
              <Link className={`${secondaryButton} w-full shrink-0 sm:w-auto`} href="/review">Add a role</Link>
            </div>

            {applications.length > 0 ? (
              <ol className="mt-6 grid gap-5" aria-label="Application materials">
                {applications.map((application) => {
                  const requests = listTailorRequests(application.job.id);
                  const activeRequest = requests.find((request) => request.status === "queued" || request.status === "running");
                  const latestRequest = requests[0];
                  const variants = [...listResumeVariants(application.job.id)].reverse();
                  const latestVariant = variants[0];
                  const latestFreshness = latestVariant ? materialFreshness(latestVariant, application.job, profile) : null;
                  const latestReadiness = latestVariant && latestFreshness ? materialReadiness(latestVariant.fitAssessment, latestFreshness) : null;
                  const resumeHeadline = latestVariant?.resumeJson.headline?.trim();
                  const resumeSummary = latestVariant?.resumeJson.summary?.trim();
                  const resumeNeedsUpdate = latestFreshness ? materialNeedsRefresh(latestFreshness) : false;
                  const hasCoverLetter = Boolean(latestVariant?.coverLetter?.trim());

                  return (
                    <li key={application.id}>
                      <article className={card}>
                        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={tag}>{application.status.replace(/\b\w/g, (letter) => letter.toUpperCase())} application</span>
                              {latestVariant && latestReadiness ? <span className={latestReadiness.className}>{latestReadiness.label}</span> : latestRequest ? <span className={requestClass(latestRequest.status)}>{requestLabel(latestRequest.status)}</span> : <span className={tag}>No materials yet</span>}
                            </div>
                            <Link className="mt-3 block break-words font-serif text-xl font-semibold leading-tight tracking-[-0.035em] text-[var(--ink)] transition hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)] sm:text-2xl" href={`/jobs/${application.job.id}`}>{application.job.title}</Link>
                            <p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(application.company.name)}</p>
                          </div>
                          <Link className={`${secondaryButton} w-full shrink-0 sm:w-auto`} href={`/jobs/${application.job.id}`}>View role</Link>
                        </header>

                        {latestVariant ? (
                          <section className="mt-5 rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--rust)_3%,transparent)] p-4 sm:p-5" aria-label={`Current resume for ${application.job.title}`}>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-[var(--rust)]">Current resume</p>
                                <h3 className="mt-1 break-words font-serif text-xl font-semibold leading-tight tracking-[-0.03em] text-[var(--ink)]">{resumeHeadline || application.job.title}</h3>
                                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">For {application.job.title} · Prepared {dateLabel(latestVariant.createdAt)}</p>
                              </div>
                              {latestReadiness ? <span className={`${latestReadiness.className} self-start`}>{latestReadiness.label}</span> : null}
                            </div>

                            {resumeSummary ? <p className="mt-4 line-clamp-3 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">{resumeSummary}</p> : null}

                            <div className="mt-4 grid gap-2 sm:grid-cols-2">
                              <a className={`${primaryButton} w-full`} href={`/api/exports/${latestVariant.id}?format=pdf`}>Open resume PDF</a>
                              <a className={`${secondaryButton} w-full`} href={`/api/exports/${latestVariant.id}?format=html`}>Open resume HTML</a>
                            </div>

                            <div className="mt-3 flex flex-col gap-3 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4 sm:flex-row sm:flex-wrap sm:items-center">
                              {activeRequest ? (
                                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                  <span className={requestClass(activeRequest.status)} aria-live="polite">{requestLabel(activeRequest.status)}</span>
                                  <span className="text-xs leading-5 text-[var(--muted)]">{activeRequest.status === "running" ? "Preparing a newer resume." : "Run the command to prepare it."}</span>
                                  {activeRequest.status === "queued" ? <code className="max-w-full break-words rounded-lg border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">pnpm tailor -- --next</code> : null}
                                </div>
                              ) : (
                                <form action={queueTailorVariantAction} className="w-full sm:w-auto">
                                  <input name="job_id" type="hidden" value={application.job.id} />
                                  <button className={`${quietButton} w-full sm:w-auto`} type="submit">{resumeNeedsUpdate ? "Update resume" : "Create fresh resume"}</button>
                                </form>
                              )}
                              <Link className={`text-sm ${textLink}`} href="/apply">Continue to form</Link>
                            </div>

                            {hasCoverLetter ? (
                              <details className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-[var(--ink)] marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rust)]">
                                  <span>Cover letter</span>
                                  <span className="text-xs font-semibold text-[var(--rust)]">Edit</span>
                                </summary>
                                <form action={updateCoverLetterAction} className="mt-3 grid gap-3">
                                  <input name="variant_id" type="hidden" value={latestVariant.id} />
                                  <textarea aria-label={`Cover letter for variant ${latestVariant.id}`} className={`${field} min-h-52 resize-y text-sm leading-6`} defaultValue={latestVariant.coverLetter ?? ""} name="cover_letter" />
                                  <button aria-label="Save cover letter" className={`${quietButton} justify-self-start`} type="submit">Save cover letter</button>
                                </form>
                              </details>
                            ) : <p className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4 text-xs leading-5 text-[var(--muted)]">No cover letter in this version.</p>}

                            <ResumeDetails job={application.job} profile={profile} variant={latestVariant} />
                          </section>
                        ) : (
                          <section className="mt-5 rounded-2xl border border-dashed border-[color:color-mix(in_srgb,var(--ink)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_68%,transparent)] p-4 sm:p-5" aria-label={`Prepare materials for ${application.job.title}`}>
                            <p className="text-xs font-semibold text-[var(--rust)]">No resume yet</p>
                            <h3 className="mt-1 font-serif text-xl font-semibold tracking-[-0.03em] text-[var(--ink)]">Create a tailored resume.</h3>
                            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Use your saved experience for this role.</p>
                            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                              {activeRequest ? (
                                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                                  <span className={requestClass(activeRequest.status)} aria-live="polite">{requestLabel(activeRequest.status)}</span>
                                  {activeRequest.status === "queued" ? <code className="max-w-full break-words rounded-lg border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-3 py-2 text-xs text-[var(--ink)]">pnpm tailor -- --next</code> : null}
                                </div>
                              ) : (
                                <form action={queueTailorVariantAction} className="w-full sm:w-auto">
                                  <input name="job_id" type="hidden" value={application.job.id} />
                                  <button className={`${primaryButton} w-full sm:w-auto`} type="submit">Prepare resume</button>
                                </form>
                              )}
                            </div>
                          </section>
                        )}

                        {latestRequest?.status === "failed" && latestRequest.error ? (
                          <details className="mt-4 rounded-xl border border-[#e2a298] bg-[#fff7f5] p-4">
                            <summary className="cursor-pointer text-sm font-semibold text-[#973e34] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#973e34]">See what needs attention</summary>
                            <p className="mt-2 break-words text-xs leading-5 text-[#973e34]">{latestRequest.error}</p>
                          </details>
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
                  <h3 className="mt-2 font-serif text-[1.75rem] font-semibold leading-[1.05] tracking-[-0.04em] text-[var(--ink)] sm:text-3xl">Choose a role before creating its materials.</h3>
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
