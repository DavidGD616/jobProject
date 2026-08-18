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
  if (materialNeedsRefresh(freshness)) return { label: "Refresh materials", className: warningTag };
  if (fit?.level === "low") return { label: "Low fit — review gaps", className: dangerTag };
  if (fit?.level === "caution") return { label: "Fit needs review", className: warningTag };
  if (fit?.level === "strong") return { label: "Evidence-supported", className: positiveTag };
  return { label: "Review material", className: warningTag };
}

function evidenceSourceLabel(source: TailoringEvidence["source"]): string {
  if (source === "experience") return "Work history";
  if (source === "project") return "Project";
  return "Skill";
}

function freshnessLabel(status: MaterialFreshness["profile"] | MaterialFreshness["job"], current: string, changed: string): string {
  if (status === "current") return current;
  if (status === "changed") return changed;
  return "Not recorded for this older material set";
}

function framingStatus(value: string | undefined, profileValue: string | undefined): string {
  if (!value) return "Not recorded";
  return value === profileValue ? "Kept from your profile" : "Adjusted for this role";
}

function MaterialChanges({ variant, job, profile }: { variant: ResumeVariant; job: Job; profile: Profile }) {
  const freshness = materialFreshness(variant, job, profile);
  const needsRefresh = materialNeedsRefresh(freshness);
  const fit = variant.fitAssessment;
  const evidence = variant.evidenceMap ?? [];
  const headline = variant.resumeJson.headline?.trim();
  const summary = variant.resumeJson.summary?.trim();
  const headlineStatus = framingStatus(headline, profile.resumeJson.headline?.trim());
  const summaryStatus = framingStatus(summary, profile.resumeJson.summary?.trim());
  const needsFitReview = fit?.level === "caution" || fit?.level === "low";
  const readiness = materialReadiness(fit, freshness);

  return (
    <section aria-labelledby={`changes-${variant.id}`} className="mt-5 rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--rust)_3%,transparent)] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-[var(--rust)]">Factual tailoring record</p>
          <h3 className="mt-1 font-serif text-xl font-semibold tracking-[-0.03em] text-[var(--ink)]" id={`changes-${variant.id}`}>What changed for this role</h3>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--muted)]">The material below only uses saved facts. Your past employer titles are not renamed.</p>
        </div>
        <span className={readiness.className}>{readiness.label}</span>
      </div>

      {needsRefresh || needsFitReview || !fit ? (
        <div className={`mt-4 rounded-xl border px-4 py-3 text-sm leading-6 ${fit?.level === "low" ? "border-[#e2a298] bg-[#fff0ee] text-[#973e34]" : "border-[#d9b85d] bg-[#fff9e5] text-[#624e10]"}`} role={needsRefresh || needsFitReview ? "alert" : undefined}>
          <p className="font-semibold">
            {needsRefresh
              ? "Refresh this material set before relying on it."
              : fit?.level === "low"
                ? "This role has substantial evidence gaps. Do not treat this draft as application-ready without a careful decision."
                : fit?.level === "caution"
                  ? "Review the evidence gaps before using this draft for an application."
                  : "This older material set has no recorded fit assessment. Review it carefully before using it."}
          </p>
          <p className="mt-1 text-xs leading-5">
            {needsRefresh
              ? "Your saved profile or the source job description has changed since this version was prepared."
              : fit?.summary ?? "The role-specific evidence and gaps were not recorded with this version."}
          </p>
        </div>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] p-4">
          <p className="text-xs font-semibold text-[var(--ink)]">Resume framing</p>
          <dl className="mt-3 grid gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <dt className="text-xs font-semibold text-[var(--ink-soft)]">Professional headline</dt>
                <span className={tag}>{headlineStatus}</span>
              </div>
              <dd className="mt-1.5 text-sm font-semibold leading-6 text-[var(--ink)]">{headline || "No professional headline is recorded in this material set."}</dd>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">This frames the resume for the target role; it does not change a past job title.</p>
            </div>
            <div className="border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <dt className="text-xs font-semibold text-[var(--ink-soft)]">Summary for this role</dt>
                <span className={tag}>{summaryStatus}</span>
              </div>
              <dd className="mt-1.5 text-sm leading-6 text-[var(--ink)]">{summary || "No summary is recorded in this material set."}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] p-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold text-[var(--ink)]">Evidence selected for this role</p>
            {fit ? <span className="text-xs font-semibold text-[var(--muted)]">{fit.evidenceCount} recorded</span> : null}
          </div>
          {evidence.length > 0 ? (
            <ol className="mt-3 grid gap-2.5">
              {evidence.map((item, index) => (
                <li className="rounded-lg border border-[color:color-mix(in_srgb,var(--ink)_8%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-3 py-2.5" key={`${item.requirement}-${item.source}-${item.label}-${index}`}>
                  <p className="text-xs font-semibold text-[var(--ink)]">{item.requirement}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]"><span className="font-semibold text-[var(--rust)]">{evidenceSourceLabel(item.source)}</span> · {item.label}</p>
                </li>
              ))}
            </ol>
          ) : <p className="mt-3 rounded-lg bg-[color:color-mix(in_srgb,var(--ink)_4%,transparent)] px-3 py-2.5 text-xs leading-5 text-[var(--muted)]">No traceable evidence map was recorded for this older material set.</p>}

          {fit?.gaps.length ? (
            <div className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
              <p className="text-xs font-semibold text-[var(--ink)]">Gaps to consider</p>
              <ul className="mt-2 grid gap-1.5 text-xs leading-5 text-[var(--ink-soft)]">
                {fit.gaps.map((gap) => <li className="flex gap-2" key={gap}><span className="mt-2 size-1 shrink-0 rounded-full bg-[var(--rust)]" />{gap}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      <dl className="mt-4 grid gap-2 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4 text-xs leading-5 text-[var(--muted)] sm:grid-cols-3">
        <div><dt className="font-semibold text-[var(--ink-soft)]">Profile</dt><dd>{freshnessLabel(freshness.profile, `Version ${variant.profileVersion} · current`, "Changed since this draft")}</dd></div>
        <div><dt className="font-semibold text-[var(--ink-soft)]">Job source</dt><dd>{freshnessLabel(freshness.job, "Current when prepared", "Changed since this draft")}</dd></div>
        <div><dt className="font-semibold text-[var(--ink-soft)]">Tailoring rules</dt><dd>{variant.promptVersion ? `Version ${variant.promptVersion}` : "Not recorded for this older material set"}</dd></div>
      </dl>
    </section>
  );
}

export default async function TailorPage({ searchParams }: TailorPageProps) {
  const applications = listApplications();
  const profile = ensureActiveProfile();
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
              <p className="mt-2 text-xs leading-5 text-[color:color-mix(in_srgb,var(--paper)_68%,transparent)]">This process only uses true evidence from your profile. It can adapt the professional headline and summary, but it does not invent accomplishments, rename past roles, or redesign the document.</p>
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
                  const latestFreshness = latestVariant ? materialFreshness(latestVariant, application.job, profile) : null;
                  const latestNeedsRefresh = latestFreshness ? materialNeedsRefresh(latestFreshness) : false;
                  const latestReadiness = latestVariant && latestFreshness ? materialReadiness(latestVariant.fitAssessment, latestFreshness) : null;
                  const latestNeedsFitReview = latestVariant?.fitAssessment?.level === "caution" || latestVariant?.fitAssessment?.level === "low";
                  const coverLetterWithheld = latestVariant?.fitAssessment?.level === "low" && !latestVariant.coverLetter?.trim();

                  return (
                    <li key={application.id}>
                      <article className={card}>
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={tag}>{application.status.replace(/\b\w/g, (letter) => letter.toUpperCase())} application</span>
                              {latestVariant && latestReadiness ? <span className={latestReadiness.className}>{latestReadiness.label}</span> : latestRequest ? <span className={requestClass(latestRequest.status)}>{requestLabel(latestRequest.status)}</span> : <span className={tag}>No materials yet</span>}
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
                                  ? latestNeedsRefresh
                                    ? "This material set is no longer current. Prepare a fresh version before relying on it for the application form."
                                    : latestVariant.fitAssessment?.level === "low"
                                      ? "This role has substantial evidence gaps. Review the warning and decide whether it is worth pursuing before moving to form preparation."
                                      : latestNeedsFitReview
                                        ? "Review the role-specific evidence and gaps before you use these materials or move to form preparation."
                                        : "Open the latest PDF and letter. If both are accurate, move on to form preparation."
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
                              {latestVariant ? <Link className={`text-sm ${textLink}`} href="/apply">{latestNeedsRefresh || latestNeedsFitReview ? "Review form prep after this" : "Go to form prep"}</Link> : null}
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
                                  {latestReadiness ? <span className={latestReadiness.className}>{latestReadiness.label}</span> : null}
                                </div>
                                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                  <a className={`${primaryButton} w-full`} href={`/api/exports/${latestVariant.id}?format=pdf`}>Open resume PDF</a>
                                  <a className={`${secondaryButton} w-full`} href={`/api/exports/${latestVariant.id}?format=html`}>Open resume HTML</a>
                                </div>
                                {latestVariant.coverLetter?.trim() ? (
                                  <details className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
                                    <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Read or edit the cover letter</summary>
                                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Edit anything that does not sound like you before you use it.</p>
                                    <form action={updateCoverLetterAction} className="mt-3 grid gap-3">
                                      <input name="variant_id" type="hidden" value={latestVariant.id} />
                                      <textarea aria-label={`Cover letter for variant ${latestVariant.id}`} className={`${field} min-h-52 resize-y text-sm leading-6`} defaultValue={latestVariant.coverLetter} name="cover_letter" />
                                      <button aria-label="Save cover letter" className={`${quietButton} justify-self-start`} type="submit">Save cover letter</button>
                                    </form>
                                  </details>
                                ) : (
                                  <div className="mt-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-4">
                                    <p className={`text-sm font-semibold ${coverLetterWithheld ? "text-[#973e34]" : "text-[var(--ink)]"}`}>{coverLetterWithheld ? "Grounded cover letter withheld" : "No cover letter recorded"}</p>
                                    <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{coverLetterWithheld ? "The current profile does not provide enough truthful evidence for this role, so the app did not create a generic letter. Review the gaps before deciding whether to pursue it." : "This material set has no editable cover letter. Prepare a fresh set if you want a grounded draft."}</p>
                                  </div>
                                )}
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

                        {latestVariant ? <MaterialChanges job={application.job} profile={profile} variant={latestVariant} /> : null}

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
