import Link from "next/link";

import { ensureActiveProfile } from "@/matching";

import { WorkflowCallout } from "../_components/workflow-callout";
import {
  card,
  errorNotice,
  field,
  fieldLabel,
  notice,
  pageHeader,
  primaryButton,
  secondaryButton,
  tag,
  workspaceShell,
} from "../_components/ui";
import { saveProfileAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type ProfilePageProps = {
  searchParams: Promise<{ saved?: string; error?: string }>;
};

function csv(values: readonly string[] | undefined): string {
  return values?.join(", ") ?? "";
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const profile = ensureActiveProfile();
  const query = await searchParams;
  const preferences = profile.preferences;

  return (
    <main className="min-h-screen px-3 py-3 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={`${workspaceShell} max-w-[1240px]`}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 1 of 6 · Set up your profile</p>
              <h1 className="mt-3 max-w-3xl font-serif text-4xl font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl">Give your search a truthful point of view.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] sm:text-base">Your profile tells this workspace what you have done and what you are looking for. It powers your matches and keeps your materials grounded in real experience.</p>
            </div>
            <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--paper)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_8%,transparent)] p-5">
              <p className="text-sm font-semibold text-[var(--paper)]">Profile version {profile.version}</p>
              <p className="mt-2 text-xs leading-5 text-[color:color-mix(in_srgb,var(--paper)_68%,transparent)]">When you save, new matches will use these facts and preferences. Nothing here is shared or submitted.</p>
            </div>
          </div>
        </header>

        <div className="px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <div aria-live="polite" className="grid gap-3">
            {query.saved ? <p className={notice}>Your profile was saved. Your next step is to refresh Matches when you are ready.</p> : null}
            {query.error ? <p className={errorNotice} role="alert">{query.error}</p> : null}
          </div>

          <div className="mt-7 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[var(--rust)]">Start with what is true</p>
              <h2 className="mt-1 font-serif text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">A good profile makes every later choice easier.</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--muted)]">Use real skills, experience, and boundaries. The workspace does not make up claims to improve a match or a resume.</p>
            </div>
            <WorkflowCallout eyebrow="What this changes" title="Three useful outcomes" tone="signal">
              <ul className="grid gap-1.5 text-xs leading-5">
                <li>Matches surface roles that fit your terms.</li>
                <li>Preferences remove work you do not want.</li>
                <li>Materials stay anchored to your actual experience.</li>
              </ul>
            </WorkflowCallout>
          </div>

          <form action={saveProfileAction} className="mt-8 grid gap-7">
            <section className={card} aria-labelledby="about-you-heading">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--rust)]">About you</p>
                  <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]" id="about-you-heading">The details that travel with every application</h2>
                </div>
                <span className={tag}>Private and local</span>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className={fieldLabel}>Name<input className={field} defaultValue={profile.resumeJson.name ?? ""} name="name" placeholder="Your name" /></label>
                <label className={fieldLabel}>Email<input className={field} defaultValue={profile.resumeJson.email ?? ""} name="email" type="email" placeholder="you@example.com" /></label>
                <label className={fieldLabel}>Phone <span className="font-normal text-[var(--muted)]">(optional)</span><input className={field} defaultValue={profile.resumeJson.phone ?? ""} name="phone" placeholder="Optional" /></label>
                <label className={fieldLabel}>Location<input className={field} defaultValue={profile.resumeJson.location ?? ""} name="location" placeholder="City, region" /></label>
                <label className={`${fieldLabel} sm:col-span-2`}>Portfolio or LinkedIn URL<input className={field} defaultValue={profile.resumeJson.portfolioUrl ?? ""} name="portfolioUrl" type="url" placeholder="https://your-site.example" /></label>
                <label className={`${fieldLabel} sm:col-span-2`}>Professional headline<input className={field} defaultValue={profile.resumeJson.headline ?? ""} name="headline" placeholder="For example: Product engineer focused on reliable systems" /></label>
                <label className={`${fieldLabel} sm:col-span-2`}>Short factual summary<textarea className={`${field} min-h-28 resize-y`} defaultValue={profile.resumeJson.summary ?? ""} name="summary" placeholder="A concise, fact-based introduction." /></label>
              </div>
            </section>

            <section className={card} aria-labelledby="search-language-heading">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">How you describe your work</p>
                <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]" id="search-language-heading">Help the workspace recognize relevant roles</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Separate entries with commas. Use words that appear in real job descriptions or titles you would genuinely consider.</p>
              </div>
              <div className="mt-6 grid gap-5">
                <label className={fieldLabel}>Core skills<input className={field} defaultValue={csv(profile.skills)} name="skills" placeholder="TypeScript, product strategy, data analysis" /></label>
                <label className={fieldLabel}>Titles you would consider<input className={field} defaultValue={csv(profile.titleAliases)} name="title_aliases" placeholder="Software engineer, applied scientist" /></label>
                <details className="rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_62%,transparent)] p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Advanced: map alternate names for your skills</summary>
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Only use this if you are comfortable editing JSON. It lets one skill match common alternate wording in job descriptions.</p>
                  <label className="mt-4 block text-sm font-semibold text-[var(--ink)]">
                    Skill aliases (JSON)
                    <textarea className={`${field} min-h-32 resize-y font-mono text-xs leading-5`} defaultValue={JSON.stringify(profile.skillAliases, null, 2)} name="skill_aliases" />
                  </label>
                </details>
              </div>
            </section>

            <section className={card} aria-labelledby="preferences-heading">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">What you want</p>
                <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]" id="preferences-heading">Set the boundaries that make a role worth seeing</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Leave a field empty if you are flexible. These are preferences, not promises about any individual job listing.</p>
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <fieldset className="rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_58%,transparent)] p-4 sm:col-span-2">
                  <legend className="px-1 text-sm font-semibold text-[var(--ink)]">Work setting</legend>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Choose every option that could work for you.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["remote", "hybrid", "onsite"] as const).map((type) => (
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[color:color-mix(in_srgb,var(--ink)_13%,transparent)] bg-[var(--paper)] px-3 py-2 text-sm font-semibold text-[var(--ink-soft)]" key={type}>
                        <input className="accent-[var(--rust)]" defaultChecked={preferences.remoteTypes?.includes(type)} name="remote_types" type="checkbox" value={type} />
                        {type[0]?.toUpperCase()}{type.slice(1)}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className={fieldLabel}>Minimum annual salary <span className="font-normal text-[var(--muted)]">(only when published)</span><input className={field} defaultValue={preferences.minSalary ?? ""} min="1" name="min_salary" type="number" /></label>
                <label className={fieldLabel}>Currencies you would consider<input className={field} defaultValue={csv(preferences.currencies)} name="currencies" placeholder="USD, GBP, EUR" /></label>
                <label className={fieldLabel}>Preferred locations<input className={field} defaultValue={csv(preferences.locations)} name="locations" placeholder="New York, London" /></label>
                <label className={fieldLabel}>Preferred seniority<input className={field} defaultValue={csv(preferences.seniorities)} name="seniorities" placeholder="Senior, staff" /></label>
                <label className={fieldLabel}>Terms that rule a role out<input className={field} defaultValue={csv(preferences.exclusions)} name="exclusions" placeholder="Contract, clearance" /></label>
                <label className={fieldLabel}>Work authorization terms<input className={field} defaultValue={csv(preferences.visaKeywords)} name="visa_keywords" placeholder="Visa sponsorship, US work authorization" /></label>
                <label className={`${fieldLabel} sm:col-span-2`}>Companies you would especially like to see<input className={field} defaultValue={csv(preferences.targetCompanies)} name="target_companies" placeholder="Optional focus companies" /></label>
              </div>
            </section>

            <section className={card} aria-labelledby="resume-data-heading">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--rust)]">Your full experience</p>
                  <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]" id="resume-data-heading">The factual source for your resume materials</h2>
                </div>
                <span className={tag}>Advanced</span>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">This structured resume data is the source for all role-specific materials. Keep every bullet truthful; the app can rearrange or rephrase facts, but it will not create new ones.</p>
              <details className="mt-5 rounded-xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_62%,transparent)] p-4">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">View or edit structured resume data</summary>
                <p className="mt-2 text-xs leading-5 text-[var(--muted)]">This needs valid JSON. If you do not need to change your experience, you can leave it closed.</p>
                <textarea aria-label="Structured resume JSON" className={`${field} mt-4 min-h-[28rem] resize-y font-mono text-xs leading-5`} defaultValue={JSON.stringify(profile.resumeJson, null, 2)} name="resume_json" />
              </details>
            </section>

            <div className="sticky bottom-4 flex flex-col gap-4 rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_14%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_92%,transparent)] p-4 shadow-[0_12px_30px_rgba(17,34,55,0.12)] sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-[var(--ink-soft)]">Ready when the facts and preferences above feel like you.</p>
              <div className="flex flex-wrap gap-3">
                <Link className={secondaryButton} href="/review">View my matches</Link>
                <button className={primaryButton} type="submit">Save profile</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
