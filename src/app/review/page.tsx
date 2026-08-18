import Link from "next/link";

import { ensureActiveProfile, listRankedMatches } from "@/matching";

import { refreshMatchesAction, triageAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type ReviewPageProps = {
  searchParams: Promise<{ refreshed?: string; saved?: string; error?: string }>;
};

function scoreLabel(learned: number | null, score: number | null, retrieval: number): string {
  if (learned !== null) return `${Math.round(learned)} · learned`;
  return score === null ? `${Math.round(retrieval * 100)} · lexical` : `${score} · reranked`;
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const profile = ensureActiveProfile();
  const matches = listRankedMatches(profile.id, { limit: 100 });
  const query = await searchParams;
  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-10" id="main-content">
      <div className="ledger-shell mx-auto max-w-[1480px] overflow-hidden border border-[var(--ledger-border)] bg-[var(--paper)] shadow-[0_24px_80px_rgba(45,35,17,0.12)]">
        <AppNav />
        <header className="ledger-masthead px-6 py-8 text-[var(--paper)] sm:px-10 lg:px-12">
          <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
            <div><p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--signal)]">Ranked review · profile v{profile.version}</p><h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.94] tracking-[-0.045em] sm:text-5xl">Spend attention where it compounds.</h1><p className="mt-4 max-w-2xl text-sm leading-6 text-[color:rgba(255,250,238,0.72)]">Stage-two retrieval is instant. Stage-three CLI reranking is optional and runs from the worker.</p></div>
            <form action={refreshMatchesAction}><button className="ledger-button ledger-button-inverse" type="submit">Refresh retrieval</button></form>
          </div>
        </header>
        <div className="border-b border-[var(--ledger-border)] bg-[var(--paper-deep)] px-6 py-4 sm:px-10">
          {query.refreshed ? <p className="ledger-notice" role="status">Retrieval refreshed. Run <code>pnpm jobs:rank -- --rerank</code> when you want the optional CLI pass.</p> : null}
          {query.saved ? <p className="ledger-notice" role="status">Triage decision saved.</p> : null}
          {query.error ? <p className="ledger-error" role="alert">{query.error}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--muted)]"><span>{matches.length} ranked role{matches.length === 1 ? "" : "s"} ready</span><span>Profile changes invalidate prior scores.</span></div>
        </div>
        {matches.length > 0 ? (
          <ol className="divide-y divide-[var(--ledger-border)]">
            {matches.map((match, index) => (
              <li className="review-card grid gap-5 px-6 py-7 sm:px-10 lg:grid-cols-[3.5rem_minmax(0,1fr)_14rem]" key={match.job.id}>
                <p className="font-mono text-xs font-bold tracking-[0.16em] text-[var(--rust)]">{String(index + 1).padStart(2, "0")}</p>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><a className="font-serif text-2xl leading-tight tracking-[-0.035em] text-[var(--ink)] hover:text-[var(--rust)]" href={match.job.url} rel="noreferrer" target="_blank">{match.job.title} ↗</a><p className="mt-2 text-sm font-semibold text-[var(--ink-soft)]">{match.company.name}</p></div><span className="ledger-score">{scoreLabel(match.learnedScore, match.llmScore, match.retrievalScore)}</span></div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--muted)]">{match.job.location ? <span className="ledger-tag">{match.job.location}</span> : null}{match.job.remoteType && match.job.remoteType !== "unknown" ? <span className="ledger-tag ledger-tag-signal capitalize">{match.job.remoteType}</span> : null}{match.job.seniority ? <span className="ledger-tag capitalize">{match.job.seniority}</span> : null}{match.triageDecision === "interested" ? <span className="ledger-tag ledger-tag-signal">Interested</span> : null}</div>
                  <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--ink-soft)]">{match.reasoning ?? "Retrieved through profile terms, title aliases, structured preferences, and freshness."}</p>
                  {match.strengths.length > 0 || match.gaps.length > 0 ? <div className="mt-4 grid gap-3 sm:grid-cols-2">{match.strengths.length > 0 ? <div><p className="ledger-kicker">Strengths</p><p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{match.strengths.join(" · ")}</p></div> : null}{match.gaps.length > 0 ? <div><p className="ledger-kicker">Gaps</p><p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{match.gaps.join(" · ")}</p></div> : null}</div> : null}
                </div>
                <div className="flex flex-wrap content-start gap-2 lg:justify-end"><Link className="ledger-action" href={`/jobs/${match.job.id}`}>View details</Link><form action={triageAction} className="flex flex-wrap gap-2"><input name="job_id" type="hidden" value={match.job.id} /><input name="profile_id" type="hidden" value={profile.id} /><input name="company_id" type="hidden" value={match.company.id} /><button className="ledger-action ledger-action-positive" name="decision" type="submit" value="interested">Interested</button><button className="ledger-action" name="decision" type="submit" value="skip">Skip</button><button className="ledger-action ledger-action-danger" name="decision" type="submit" value="block_company">Block company</button></form></div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="grid min-h-[440px] place-items-center px-8 py-16 text-center"><div className="max-w-lg"><p className="ledger-kicker">No retrieval rows yet</p><h2 className="mt-3 font-serif text-4xl tracking-[-0.04em]">Start with your profile, then refresh the field.</h2><p className="mt-4 text-sm leading-6 text-[var(--muted)]">The app keeps the lexical pass available even when no LLM CLI is installed. Once rows exist, the optional worker rerank adds reasons, strengths, and gaps.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link className="ledger-button inline-flex items-center" href="/profile">Edit profile</Link><form action={refreshMatchesAction}><button className="ledger-button ledger-button-soft" type="submit">Refresh now</button></form></div></div></div>
        )}
      </div>
    </main>
  );
}
