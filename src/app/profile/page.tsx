import Link from "next/link";

import { ensureActiveProfile } from "@/matching";

import { AppNav } from "../nav";
import { saveProfileAction } from "../actions";

export const runtime = "nodejs";

type ProfilePageProps = {
  searchParams: Promise<{ saved?: string; error?: string }>;
};

function csv(values: readonly string[]): string {
  return values.join(", ");
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const profile = ensureActiveProfile();
  const query = await searchParams;
  const preferences = profile.preferences;
  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-10">
      <div className="ledger-shell mx-auto max-w-[1180px] overflow-hidden border border-[var(--ledger-border)] bg-[var(--paper)] shadow-[0_24px_80px_rgba(45,35,17,0.12)]">
        <AppNav />
        <header className="ledger-masthead px-6 py-8 text-[var(--paper)] sm:px-10">
          <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--signal)]">Profile · version {profile.version}</p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.94] tracking-[-0.045em] sm:text-5xl">Give the ledger a point of view.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:rgba(255,250,238,0.72)]">This is the structured source of truth used for lexical retrieval, ranking, and fact-grounded tailoring. Save real facts only; the app never invents resume content.</p>
        </header>

        <div className="px-6 py-8 sm:px-10">
          {query.saved ? <p className="ledger-notice" role="status">Profile saved. Its version advanced and previous match scores are ready to be refreshed.</p> : null}
          {query.error ? <p className="ledger-error" role="alert">{query.error}</p> : null}
          <form action={saveProfileAction} className="grid gap-8">
            <section aria-labelledby="identity-heading">
              <div className="ledger-section-heading"><p>Identity</p><h2 id="identity-heading">The facts that travel with you</h2></div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <label className="ledger-field"><span>Name</span><input className="ledger-control" defaultValue={profile.resumeJson.name ?? ""} name="name" placeholder="Your name" /></label>
                <label className="ledger-field"><span>Email</span><input className="ledger-control" defaultValue={profile.resumeJson.email ?? ""} name="email" type="email" placeholder="you@example.com" /></label>
                <label className="ledger-field"><span>Phone</span><input className="ledger-control" defaultValue={profile.resumeJson.phone ?? ""} name="phone" placeholder="Optional" /></label>
                <label className="ledger-field"><span>Location</span><input className="ledger-control" defaultValue={profile.resumeJson.location ?? ""} name="location" placeholder="City, region" /></label>
                <label className="ledger-field sm:col-span-2"><span>Headline</span><input className="ledger-control" defaultValue={profile.resumeJson.headline ?? ""} name="headline" placeholder="Senior product engineer focused on reliable systems" /></label>
                <label className="ledger-field sm:col-span-2"><span>Summary</span><textarea className="ledger-control min-h-28" defaultValue={profile.resumeJson.summary ?? ""} name="summary" placeholder="A concise, factual summary." /></label>
              </div>
            </section>

            <section aria-labelledby="search-heading">
              <div className="ledger-section-heading"><p>Search language</p><h2 id="search-heading">Teach retrieval what matters</h2></div>
              <div className="mt-5 grid gap-5">
                <label className="ledger-field"><span>Skills <small>(comma separated)</small></span><input className="ledger-control" defaultValue={csv(profile.skills)} name="skills" placeholder="typescript, postgres, product strategy" /></label>
                <label className="ledger-field"><span>Title aliases <small>(comma separated)</small></span><input className="ledger-control" defaultValue={csv(profile.titleAliases)} name="title_aliases" placeholder="software engineer, applied scientist" /></label>
                <label className="ledger-field"><span>Skill aliases <small>(JSON object)</small></span><textarea className="ledger-control min-h-24 font-mono text-xs" defaultValue={JSON.stringify(profile.skillAliases, null, 2)} name="skill_aliases" /></label>
              </div>
            </section>

            <section aria-labelledby="preferences-heading">
              <div className="ledger-section-heading"><p>Boundaries</p><h2 id="preferences-heading">The work you want to see</h2></div>
              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <fieldset className="ledger-field"><legend>Work style</legend><div className="flex flex-wrap gap-3 pt-2">{(["remote", "hybrid", "onsite"] as const).map((type) => <label className="ledger-check" key={type}><input defaultChecked={preferences.remoteTypes?.includes(type)} name="remote_types" type="checkbox" value={type} /><span className="capitalize">{type}</span></label>)}</div></fieldset>
                <label className="ledger-field"><span>Minimum salary <small>(published salary only)</small></span><input className="ledger-control" defaultValue={preferences.minSalary ?? ""} min="1" name="min_salary" type="number" /></label>
                <label className="ledger-field"><span>Locations <small>(comma separated)</small></span><input className="ledger-control" defaultValue={csv(preferences.locations ?? [])} name="locations" placeholder="New York, London" /></label>
                <label className="ledger-field"><span>Seniority <small>(comma separated)</small></span><input className="ledger-control" defaultValue={csv(preferences.seniorities ?? [])} name="seniorities" placeholder="senior, staff" /></label>
                <label className="ledger-field"><span>Exclude terms <small>(comma separated)</small></span><input className="ledger-control" defaultValue={csv(preferences.exclusions ?? [])} name="exclusions" placeholder="contract, clearance" /></label>
                <label className="ledger-field"><span>Target companies <small>(comma separated)</small></span><input className="ledger-control" defaultValue={csv(preferences.targetCompanies ?? [])} name="target_companies" placeholder="Optional focus" /></label>
              </div>
            </section>

            <section aria-labelledby="resume-heading">
              <div className="ledger-section-heading"><p>Resume source</p><h2 id="resume-heading">Structured experience and bullets</h2></div>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Keep this JSON factual. Experience bullets are selected and rephrased later, never fabricated.</p>
              <textarea aria-label="Structured resume JSON" className="ledger-control mt-5 min-h-[25rem] font-mono text-xs leading-5" defaultValue={JSON.stringify(profile.resumeJson, null, 2)} name="resume_json" />
            </section>

            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--ledger-border)] pt-6">
              <Link className="ledger-text-link" href="/review">Back to review</Link>
              <button className="ledger-button" type="submit">Save profile</button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
