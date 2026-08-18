import Link from "next/link";

import { db, displayCompanyName } from "@/db";
import { companies } from "@/db/schema";
import {
  applicationStatuses,
  funnelStats,
  listApplications,
  listContacts,
} from "@/tracking";

import { WorkflowCallout } from "../_components/workflow-callout";
import {
  card,
  dangerTag,
  errorNotice,
  field,
  fieldLabel,
  notice,
  pageHeader,
  positiveTag,
  primaryButton,
  secondaryButton,
  tag,
  textLink,
  warningTag,
  workspaceShell,
} from "../_components/ui";
import { addContactAction, updateApplicationAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type PipelinePageProps = {
  searchParams: Promise<{ saved?: string; error?: string }>;
};

function dateValue(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

function readableStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusClass(status: string): string {
  if (["offer", "interview", "screen", "responded"].includes(status)) return positiveTag;
  if (["rejected", "withdrawn", "ghosted"].includes(status)) return dangerTag;
  if (["applied", "ready"].includes(status)) return warningTag;
  return tag;
}

function nextMove(status: string): string {
  const moves: Record<string, string> = {
    draft: "Decide whether to prepare materials or let this go.",
    ready: "Check the materials and form prep before submitting yourself.",
    applied: "Set a follow-up date so this does not disappear.",
    responded: "Capture the conversation and set the next follow-up.",
    screen: "Prepare for the screen and write down the next checkpoint.",
    interview: "Keep interview notes and the next step together here.",
    offer: "Record your decision timeline and any open questions.",
    rejected: "Keep the outcome for future learning, then move on.",
    ghosted: "Choose a final follow-up or close this out.",
    withdrawn: "Keep the record, but no action is required.",
  };
  return moves[status] ?? "Add a clear next step.";
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const applications = listApplications();
  const contacts = listContacts();
  const companiesForContact = db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name).all();
  const stats = funnelStats();
  const query = await searchParams;
  const countFor = (...statuses: string[]) => stats.filter((item) => statuses.includes(item.status)).reduce((sum, item) => sum + item.count, 0);
  const activeCount = countFor("draft", "ready", "applied", "responded", "screen", "interview", "offer");
  const dueFollowups = applications.filter((application) => application.nextFollowupAt && application.nextFollowupAt <= new Date()).length;
  const overview = [
    { label: "In progress", count: activeCount, detail: "roles you are still moving" },
    { label: "Follow-ups due", count: dueFollowups, detail: "need a check-in or decision" },
    { label: "Interviews", count: countFor("screen", "interview"), detail: "conversations in motion" },
    { label: "Offers", count: countFor("offer"), detail: "decisions to compare" },
  ];

  return (
    <main className="min-h-screen px-3 py-3 sm:px-6 sm:py-6 lg:px-10 lg:py-8" id="main-content">
      <div className={workspaceShell}>
        <AppNav />

        <header className={pageHeader}>
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            <div>
              <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)]">Step 4 of 6 · Keep applications moving</p>
              <h1 className="mt-3 max-w-3xl font-serif text-[2.1rem] font-semibold leading-[0.98] tracking-[-0.05em] sm:text-5xl">Know exactly what needs your attention next.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:color-mix(in_srgb,var(--paper)_72%,transparent)] sm:text-base">This is your private record of applications, conversations, notes, and follow-ups. It never sends an application for you.</p>
            </div>
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--paper)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_8%,transparent)] p-4">
                <dt className="text-xs text-[color:color-mix(in_srgb,var(--paper)_65%,transparent)]">In progress</dt>
                <dd className="mt-1 font-serif text-3xl font-semibold">{activeCount}</dd>
              </div>
              <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--paper)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_8%,transparent)] p-4">
                <dt className="text-xs text-[color:color-mix(in_srgb,var(--paper)_65%,transparent)]">Follow-ups due</dt>
                <dd className="mt-1 font-serif text-3xl font-semibold">{dueFollowups}</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
          <div aria-live="polite" className="grid gap-3">
            {query.saved ? <p className={notice}>Your application record was updated.</p> : null}
            {query.error ? <p className={errorNotice} role="alert">{query.error}</p> : null}
          </div>

          <section aria-labelledby="overview-heading" className="mt-7">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-semibold text-[var(--rust)]">At a glance</p>
                <h2 className="mt-1 font-serif text-[1.75rem] font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-3xl" id="overview-heading">Your application picture</h2>
              </div>
              <p className="max-w-md text-sm leading-6 text-[var(--muted)]">Update the status only when something has actually changed. Keep the next follow-up concrete.</p>
            </div>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {overview.map((item) => (
                <div className="rounded-2xl border border-[color:color-mix(in_srgb,var(--ink)_12%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] p-4" key={item.label}>
                  <dt className="text-sm font-semibold text-[var(--ink-soft)]">{item.label}</dt>
                  <dd className="mt-3 font-serif text-4xl font-semibold tracking-[-0.05em] text-[var(--ink)]">{item.count}</dd>
                  <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{item.detail}</p>
                </div>
              ))}
            </dl>
          </section>

          <div className="mt-9 grid gap-8 xl:grid-cols-[minmax(0,1fr)_21rem]">
            <section aria-labelledby="applications-heading">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                <div>
                  <p className="text-sm font-semibold text-[var(--rust)]">Your roles</p>
                  <h2 className="mt-1 font-serif text-[1.75rem] font-semibold tracking-[-0.04em] text-[var(--ink)] sm:text-3xl" id="applications-heading">Applications in one place</h2>
                </div>
                <Link className={`text-sm ${textLink}`} href="/review">Find more matches</Link>
              </div>

              {applications.length > 0 ? (
                <ol className="mt-5 grid gap-4">
                  {applications.map((application) => (
                    <li key={application.id}>
                      <article className={card}>
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={statusClass(application.status)}>{readableStatus(application.status)}</span>
                              {application.nextFollowupAt ? <span className={tag}>Follow up {dateValue(application.nextFollowupAt)}</span> : <span className={tag}>No follow-up set</span>}
                            </div>
                            <Link className="mt-3 block break-words font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)] transition hover:text-[var(--rust)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--rust)]" href={`/jobs/${application.job.id}`}>{application.job.title}</Link>
                            <p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{displayCompanyName(application.company.name)}</p>
                          </div>
                          <Link className={`${secondaryButton} w-full shrink-0 lg:w-auto`} href={`/jobs/${application.job.id}`}>Read role</Link>
                        </div>

                        <div className="mt-5 grid gap-4 border-t border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pt-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(20rem,1fr)]">
                          <div className="rounded-xl bg-[color:color-mix(in_srgb,var(--rust)_6%,transparent)] p-4">
                            <p className="text-xs font-semibold text-[var(--rust)]">Suggested next move</p>
                            <p className="mt-1.5 text-sm leading-6 text-[var(--ink-soft)]">{application.notes || nextMove(application.status)}</p>
                            {application.notes ? <p className="mt-3 text-xs leading-5 text-[var(--muted)]">This is the note you saved for yourself. Update it whenever the next action changes.</p> : null}
                          </div>

                          <form action={updateApplicationAction} className="grid gap-4 sm:grid-cols-2">
                            <input name="application_id" type="hidden" value={application.id} />
                            <label className={fieldLabel}>
                              Current stage
                              <select className={field} defaultValue={application.status} name="status">
                                {applicationStatuses.map((status) => <option key={status} value={status}>{readableStatus(status)}</option>)}
                              </select>
                            </label>
                            <label className={fieldLabel}>
                              Next follow-up
                              <input className={field} defaultValue={dateValue(application.nextFollowupAt)} name="next_followup" type="date" />
                            </label>
                            <label className={`${fieldLabel} sm:col-span-2`}>
                              Your next action or note
                              <input className={field} defaultValue={application.notes ?? ""} name="notes" placeholder="For example: Email Jordan on Tuesday" />
                            </label>
                            <div className="flex flex-col items-stretch gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs leading-5 text-[var(--muted)]">Saving creates a clear record of any status or follow-up change.</p>
                              <button className={`${primaryButton} w-full sm:w-auto`} type="submit">Save changes</button>
                            </div>
                          </form>
                        </div>
                      </article>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="mt-5 grid min-h-[360px] place-items-center rounded-3xl border border-dashed border-[color:color-mix(in_srgb,var(--ink)_18%,transparent)] bg-[color:color-mix(in_srgb,var(--paper)_70%,transparent)] px-6 py-12 text-center">
                  <div className="max-w-lg">
                    <p className="text-sm font-semibold text-[var(--rust)]">No applications yet</p>
                    <h3 className="mt-2 font-serif text-3xl font-semibold tracking-[-0.04em] text-[var(--ink)]">Choose one promising role to start your list.</h3>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">When you save a role from Matches, it becomes a draft here. Nothing is sent anywhere.</p>
                    <Link className={`${primaryButton} mt-6`} href="/review">Look through my matches</Link>
                  </div>
                </div>
              )}
            </section>

            <aside className="grid content-start gap-5" aria-label="Application context">
              <WorkflowCallout eyebrow="A useful habit" title="Write the next action, not just the status" tone="signal">
                “Applied” is history. “Follow up Thursday with the recruiter” tells you what to do next.
              </WorkflowCallout>

              <section className={card} aria-labelledby="contacts-heading">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[var(--rust)]">People</p>
                    <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]" id="contacts-heading">Useful context</h2>
                  </div>
                  <span className={tag}>{contacts.length}</span>
                </div>
                <div className="mt-4 grid gap-3">
                  {contacts.length > 0 ? contacts.map(({ contact, company }) => (
                    <div className="border-b border-[color:color-mix(in_srgb,var(--ink)_10%,transparent)] pb-3 last:border-0 last:pb-0" key={contact.id}>
                      <p className="text-sm font-semibold text-[var(--ink)]">{contact.name || "Unnamed contact"}</p>
                      <p className="mt-0.5 text-xs leading-5 text-[var(--muted)]">{displayCompanyName(company.name)}{contact.role ? ` · ${contact.role}` : ""}</p>
                      {contact.email ? <a className={`mt-1 inline-block text-xs ${textLink}`} href={`mailto:${contact.email}`}>{contact.email}</a> : null}
                    </div>
                  )) : <p className="text-sm leading-6 text-[var(--muted)]">Add a recruiter, referrer, or teammate when they make a role easier to follow up on.</p>}
                </div>
              </section>

              <section className={card} aria-labelledby="add-contact-heading">
                <p className="text-sm font-semibold text-[var(--rust)]">Add a person</p>
                <h2 className="mt-1 font-serif text-2xl font-semibold tracking-[-0.035em] text-[var(--ink)]" id="add-contact-heading">Keep the connection close to the role.</h2>
                <form action={addContactAction} className="mt-5 grid gap-4">
                  <label className={fieldLabel}>
                    Company
                    <select className={field} name="company_id" required>
                      <option value="">Choose a company</option>
                      {companiesForContact.map((company) => <option key={company.id} value={company.id}>{displayCompanyName(company.name)}</option>)}
                    </select>
                  </label>
                  <label className={fieldLabel}>Name<input className={field} name="name" placeholder="A real person" /></label>
                  <label className={fieldLabel}>Role or relationship<input className={field} name="role" placeholder="Recruiter, teammate, referral…" /></label>
                  <label className={fieldLabel}>Email<input className={field} name="email" type="email" /></label>
                  <label className={fieldLabel}>LinkedIn URL<input className={field} name="linkedin" type="url" /></label>
                  <label className={fieldLabel}>Context or reminder<textarea className={`${field} min-h-24 resize-y`} name="contact_notes" /></label>
                  <button className={`${secondaryButton} w-full`} type="submit">Save contact</button>
                </form>
              </section>
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
