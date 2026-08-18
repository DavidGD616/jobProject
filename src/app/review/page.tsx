import Link from "next/link";

import { displayCompanyName } from "@/db";
import { ensureActiveProfile, listRankedMatches } from "@/matching";

import { WorkflowCallout } from "../_components/workflow-callout";
import {
  card,
  errorNotice,
  notice,
  pageHeader,
  positiveTag,
  primaryButton,
  quietButton,
  secondaryButton,
  tag,
  textLink,
  workspaceShell,
} from "../_components/ui";
import { refreshMatchesAction, triageAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type ReviewPageProps = {
  searchParams: Promise<{ refreshed?: string; saved?: string; error?: string }>;
};

function scoreLabel(learned: number | null, score: number | null, retrieval: number): string {
  const value = learned ?? score ?? Math.round(retrieval * 100);
  return `Fit signal: ${Math.round(value)}/100`;
}

function scoreSource(learned: number | null, score: number | null): string {
  if (learned !== null) return "Informed by your saved choices";
  if (score !== null) return "Refined from your saved profile";
  return "Based on your profile and the role details";
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const profile = ensureActiveProfile();
  const matches = listRankedMatches(profile, { limit: 100 });
  const query = await searchParams;

  return (
    <main className="min-h-screen px-3 py-3 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={workspaceShell}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 3 of 6 · Look through your matches</p>
              <h1 className="mt-3 max-w-3xl font-serif text-[2.1rem] font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl">Choose the roles that deserve your time.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] sm:text-base">Start with the strongest local matches, make one quick call, and keep only the opportunities you want to move forward.</p>
            </div>
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--paper)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_8%,transparent)] p-5">
              <p className="text-sm font-semibold text-[var(--paper)]">A score is a priority, not a hiring prediction.</p>
              <p className="mt-2 text-xs leading-5 text-[color:color-mix(in_srgb,var(--paper)_68%,transparent)]">It helps you decide what to read first using your profile, preferences, and past choices.</p>
              <form action={refreshMatchesAction} className="mt-4">
                <button className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-[var(--paper)] px-3 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[color:color-mix(in_srgb,var(--paper)_86%,transparent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--paper)]" type="submit">Refresh my shortlist</button>
              </form>
            </div>
          </div>
        </header>

        <div className="px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <div aria-live="polite" className="grid gap-3">
            {query.refreshed ? <p className={notice}>Your shortlist is up to date. The fit signals reflect the profile and preferences you have saved.</p> : null}
            {query.saved ? <p className={notice}>Your choice was saved. The next role is ready when you are.</p> : null}
            {query.error ? <p className={errorNotice} role="alert">{query.error}</p> : null}
          </div>

          <section aria-labelledby="review-heading" className="mt-7">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">Your matches</p>
                <h2 className="mt-1 font-serif text-[1.75rem] font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-3xl" id="review-heading">{matches.length === 0 ? "No roles ready to review" : `${matches.length} role${matches.length === 1 ? "" : "s"} ready for a decision`}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">For each role: read why it surfaced, open the posting if it looks promising, then save a simple yes or no.</p>
              </div>
              <WorkflowCallout eyebrow="A quick way to decide" title="Ask three questions" tone="signal">
                <ol className="grid gap-1.5 pl-4 text-xs leading-5 marker:font-semibold">
                  <li>Is the work genuinely interesting?</li>
                  <li>Do the requirements fit enough to apply?</li>
                  <li>Would you be happy to follow up on it?</li>
                </ol>
              </WorkflowCallout>
            </div>

            {matches.length > 0 ? (
              <ol className="mt-6 grid gap-4" aria-label="Ranked roles">
                {matches.map((match, index) => {
                  const companyName = displayCompanyName(match.company.name);
                  return (
                    <li key={match.job.id}>
                      <article className={`${card} overflow-hidden`}>
                        <div className="grid gap-5 lg:grid-cols-[3rem_minmax(0,1fr)_13rem] lg:gap-7">
                          <div className="flex items-center gap-3 lg:block">
                            <span className="grid size-10 place-items-center rounded-full bg-[color:color-mix(in_srgb,var(--rust)_10%,transparent)] text-sm font-bold text-[var(--rust)]">{index + 1}</span>
                            <span className="text-xs font-medium text-[var(--muted)] lg:mt-3 lg:block">Priority</span>
                          </div>

                          <div className="min-w-0">
                            <div className="grid gap-3 min-[380px]:grid-cols-[minmax(0,1fr)_auto] min-[380px]:items-start">
                              <div className="min-w-0">
                                <Link className="break-words font-serif text-2xl font-semibold leading-tight tracking-[-0.035em] text-[var(--ink)] transition hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)]" href={`/jobs/${match.job.id}`}>{match.job.title}</Link>
                                <p className="mt-1.5 text-sm font-semibold text-[var(--ink-soft)]">{companyName}</p>
                              </div>
                              <div className="w-fit max-w-full rounded-xl border border-[color:color-mix(in_srgb,var(--rust)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--rust)_7%,transparent)] px-3 py-2 text-left min-[380px]:text-right lg:hidden">
                                <p className="text-sm font-bold text-[var(--ink)]">{scoreLabel(match.learnedScore, match.llmScore, match.retrievalScore)}</p>
                              </div>
                            </div>

                            <div className="mt-4 flex flex-wrap gap-2">
                              {match.job.location ? <span className={tag}>{match.job.location}</span> : null}
                              {match.job.remoteType && match.job.remoteType !== "unknown" ? <span className={positiveTag}>{match.job.remoteType}</span> : null}
                              {match.job.seniority ? <span className={tag}>{match.job.seniority}</span> : null}
                              {match.triageDecision === "interested" ? <span className={positiveTag}>Saved for later</span> : null}
                            </div>

                            <div className="mt-5 border-l-2 border-[var(--rust)] pl-4">
                              <p className="text-xs font-semibold text-[var(--ink)]">Why it showed up</p>
                              <p className="mt-1 text-sm leading-6 text-[var(--ink-soft)]">{match.reasoning ?? "It shares words, title signals, and preferences with the profile you saved."}</p>
                            </div>

                            {match.strengths.length > 0 || match.gaps.length > 0 ? (
                              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                                {match.strengths.length > 0 ? <div className="rounded-xl bg-[color:color-mix(in_srgb,#4b9a73_8%,transparent)] px-4 py-3"><p className="text-xs font-semibold text-[#226245]">What fits</p><p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{match.strengths.join(" · ")}</p></div> : null}
                                {match.gaps.length > 0 ? <div className="rounded-xl bg-[color:color-mix(in_srgb,var(--rust)_7%,transparent)] px-4 py-3"><p className="text-xs font-semibold text-[var(--rust)]">Worth checking</p><p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{match.gaps.join(" · ")}</p></div> : null}
                              </div>
                            ) : null}
                          </div>

                          <aside className="flex flex-col gap-3 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-5 lg:border-t-0 lg:border-l lg:pl-5 lg:pt-0">
                            <div className="hidden rounded-xl border border-[color:color-mix(in_srgb,var(--rust)_22%,transparent)] bg-[color:color-mix(in_srgb,var(--rust)_7%,transparent)] px-3 py-3 lg:block">
                              <p className="text-lg font-bold text-[var(--ink)]">{scoreLabel(match.learnedScore, match.llmScore, match.retrievalScore)}</p>
                              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{scoreSource(match.learnedScore, match.llmScore)}</p>
                            </div>
                            <Link className={`${secondaryButton} w-full`} href={`/jobs/${match.job.id}`}>Read the role</Link>
                            <form action={triageAction} className="grid gap-2">
                              <input name="job_id" type="hidden" value={match.job.id} />
                              <input name="profile_id" type="hidden" value={profile.id} />
                              <input name="company_id" type="hidden" value={match.company.id} />
                              {match.triageDecision !== "interested" ? <button className={`${primaryButton} w-full`} name="decision" type="submit" value="interested">I’m interested</button> : <Link className={`${primaryButton} w-full`} href={`/jobs/${match.job.id}`}>Continue this role</Link>}
                              <div className="grid gap-2 min-[360px]:grid-cols-2">
                                <button className={`${quietButton} min-h-11 w-full`} name="decision" type="submit" value="skip">Not now</button>
                                <button className={`${quietButton} min-h-11 w-full text-[#973e34] hover:border-[#e2a298] hover:text-[#973e34]`} name="decision" type="submit" value="block_company">Hide company</button>
                              </div>
                            </form>
                            <a className={`mt-1 text-center text-xs ${textLink}`} href={match.job.url} rel="noreferrer" target="_blank">Open original posting ↗</a>
                          </aside>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="mt-6 grid min-h-[360px] place-items-center rounded-3xl border border-dashed border-[color:color-mix(in_srgb,var(--ink)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-6 py-12 text-center">
                <div className="max-w-xl">
                  <p className="text-sm font-semibold text-[var(--rust)]">Nothing has been matched yet</p>
                  <h3 className="mt-2 font-serif text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Start with a truthful profile, then build your shortlist.</h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">Your profile supplies the skills, titles, and boundaries that make the first review useful. No AI setup is required for this first pass.</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-3">
                    <Link className={primaryButton} href="/profile">Set up my profile</Link>
                    <form action={refreshMatchesAction}><button className={secondaryButton} type="submit">Try matching now</button></form>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
