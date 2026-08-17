import Link from "next/link";

import { companies } from "@/db/schema";
import { db } from "@/db";
import {
  applicationStatuses,
  funnelStats,
  listApplications,
  listContacts,
} from "@/tracking";

import { addContactAction, updateApplicationAction } from "../actions";
import { AppNav } from "../nav";

export const runtime = "nodejs";

type PipelinePageProps = {
  searchParams: Promise<{ saved?: string; error?: string }>;
};

function dateValue(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

export default async function PipelinePage({ searchParams }: PipelinePageProps) {
  const applications = listApplications();
  const contacts = listContacts();
  const companiesForContact = db.select({ id: companies.id, name: companies.name }).from(companies).orderBy(companies.name).all();
  const stats = funnelStats();
  const query = await searchParams;
  return (
    <main className="min-h-screen px-4 py-4 sm:px-7 sm:py-7 lg:px-10 lg:py-10" id="main-content">
      <div className="ledger-shell mx-auto max-w-[1480px] overflow-hidden border border-[var(--ledger-border)] bg-[var(--paper)] shadow-[0_24px_80px_rgba(45,35,17,0.12)]">
        <AppNav />
        <header className="ledger-masthead px-6 py-8 text-[var(--paper)] sm:px-10 lg:px-12">
          <p className="font-mono text-[0.68rem] font-bold uppercase tracking-[0.24em] text-[var(--signal)]">Application ledger</p>
          <h1 className="mt-3 max-w-3xl font-serif text-4xl leading-[0.94] tracking-[-0.045em] sm:text-5xl">Make follow-through visible.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-[color:rgba(255,250,238,0.72)]">Every application has a current status and an append-only event trail. Nothing submits itself.</p>
        </header>
        <div className="grid gap-8 px-6 py-8 sm:px-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby="pipeline-heading">
            {query.saved ? <p className="ledger-notice mb-5" role="status">Pipeline change saved.</p> : null}
            {query.error ? <p className="ledger-error mb-5" role="alert">{query.error}</p> : null}
            <div className="ledger-section-heading"><p>Funnel</p><h2 id="pipeline-heading">Current applications</h2></div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">{stats.filter((item) => item.count > 0 || ["draft", "applied", "interview", "offer", "rejected"].includes(item.status)).map((item) => <div className="border border-[var(--ledger-border)] bg-[var(--paper-deep)] p-3" key={item.status}><p className="font-mono text-[0.58rem] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">{item.status}</p><p className="mt-1 font-serif text-2xl text-[var(--ink)]">{item.count}</p></div>)}</div>
            <div className="mt-7 grid gap-4">
              {applications.length > 0 ? applications.map((application) => (
                <article className="border border-[var(--ledger-border)] bg-[var(--paper-deep)] p-5" key={application.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4"><div><Link className="font-serif text-2xl tracking-[-0.035em] text-[var(--ink)] hover:text-[var(--rust)]" href={`/jobs/${application.job.id}`}>{application.job.title}</Link><p className="mt-1 text-sm font-semibold text-[var(--ink-soft)]">{application.company.name}</p></div><span className="ledger-tag ledger-tag-signal capitalize">{application.status}</span></div>
                  <form action={updateApplicationAction} className="mt-5 grid gap-4 sm:grid-cols-[10rem_11rem_minmax(0,1fr)_auto] sm:items-end"><input name="application_id" type="hidden" value={application.id} /><label className="ledger-field"><span>Status</span><select className="ledger-control" defaultValue={application.status} name="status">{applicationStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label><label className="ledger-field"><span>Follow up</span><input className="ledger-control" defaultValue={dateValue(application.nextFollowupAt)} name="next_followup" type="date" /></label><label className="ledger-field"><span>Notes</span><input className="ledger-control" defaultValue={application.notes ?? ""} name="notes" placeholder="Next concrete step" /></label><button className="ledger-button" type="submit">Save</button></form>
                </article>
              )) : <div className="border border-dashed border-[var(--ledger-border)] p-8 text-center"><p className="ledger-kicker">No applications yet</p><h3 className="mt-2 font-serif text-3xl tracking-[-0.04em]">Open a role and start a draft.</h3><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Create a draft from any job detail page, then move it through the funnel as the human work happens.</p></div>}
            </div>
          </section>

          <aside className="grid content-start gap-7">
            <section aria-labelledby="contact-heading"><div className="ledger-section-heading"><p>Network</p><h2 id="contact-heading">Contacts</h2></div><div className="mt-4 grid gap-3">{contacts.map(({ contact, company }) => <div className="border-b border-[var(--ledger-border)] pb-3" key={contact.id}><p className="text-sm font-bold text-[var(--ink)]">{contact.name || "Unnamed contact"}</p><p className="text-xs text-[var(--muted)]">{company.name}{contact.role ? ` · ${contact.role}` : ""}</p>{contact.email ? <a className="text-xs text-[var(--rust)]" href={`mailto:${contact.email}`}>{contact.email}</a> : null}</div>)}{contacts.length === 0 ? <p className="text-sm leading-6 text-[var(--muted)]">Add the people who make an application less anonymous.</p> : null}</div></section>
            <section><form action={addContactAction} className="grid gap-3 border-t border-[var(--ledger-border)] pt-5"><p className="ledger-kicker">Add a contact</p><label className="ledger-field"><span>Company</span><select className="ledger-control" name="company_id" required><option value="">Choose company</option>{companiesForContact.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><label className="ledger-field"><span>Name</span><input className="ledger-control" name="name" /></label><label className="ledger-field"><span>Role</span><input className="ledger-control" name="role" /></label><label className="ledger-field"><span>Email</span><input className="ledger-control" name="email" type="email" /></label><label className="ledger-field"><span>LinkedIn URL</span><input className="ledger-control" name="linkedin" type="url" /></label><label className="ledger-field"><span>Notes</span><textarea className="ledger-control min-h-20" name="contact_notes" /></label><button className="ledger-button" type="submit">Save contact</button></form></section>
            <section className="border-t border-[var(--ledger-border)] pt-5"><p className="ledger-kicker">Rules of the ledger</p><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Status is a queryable snapshot. Events preserve what changed and when. Follow-ups stay local and explicit.</p></section>
          </aside>
        </div>
      </div>
    </main>
  );
}
