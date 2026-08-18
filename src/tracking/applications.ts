import { and, asc, desc, eq, isNull, lte } from "drizzle-orm";

import { db } from "@/db";
import { applications, companies, contacts, events, jobs } from "@/db/schema";
import type { Application, Contact, Event } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

export const applicationStatuses = [
  "draft",
  "ready",
  "applied",
  "responded",
  "screen",
  "interview",
  "offer",
  "rejected",
  "ghosted",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof applicationStatuses)[number];

export interface ApplicationWithJob extends Application {
  job: typeof jobs.$inferSelect;
  company: typeof companies.$inferSelect;
}

export function appendEvent(input: {
  applicationId: number;
  type: string;
  payload?: Record<string, unknown>;
  database?: JobHuntDatabase;
  now?: Date;
}): Event {
  const database = input.database ?? db;
  return database.insert(events).values({
    applicationId: input.applicationId,
    type: input.type,
    occurredAt: input.now ?? new Date(),
    payload: input.payload ?? {},
  }).returning().get()!;
}

export function getApplicationForJob(jobId: number, database: JobHuntDatabase = db): Application | null {
  return database.select().from(applications).where(eq(applications.jobId, jobId)).get() ?? null;
}

export function createApplication(input: {
  jobId: number;
  notes?: string | null;
  database?: JobHuntDatabase;
  now?: Date;
}): Application {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const existing = getApplicationForJob(input.jobId, database);
  if (existing) return existing;
  const application = database.insert(applications).values({
    jobId: input.jobId,
    status: "draft",
    notes: input.notes?.trim() || null,
    createdAt: now,
    updatedAt: now,
  }).returning().get()!;
  appendEvent({
    applicationId: application.id,
    type: "created",
    payload: { status: "draft" },
    database,
    now,
  });
  return application;
}

export function updateApplication(input: {
  id: number;
  status?: ApplicationStatus;
  notes?: string | null;
  nextFollowupAt?: Date | null;
  coverLetter?: string | null;
  resumeVariantId?: number | null;
  database?: JobHuntDatabase;
  now?: Date;
}): Application {
  const database = input.database ?? db;
  const now = input.now ?? new Date();
  const before = database.select().from(applications).where(eq(applications.id, input.id)).get();
  if (!before) throw new Error(`Application ${input.id} not found`);
  const status = input.status ?? before.status;
  const after = database.update(applications).set({
    status,
    notes: input.notes === undefined ? before.notes : input.notes?.trim() || null,
    nextFollowupAt: input.nextFollowupAt === undefined ? before.nextFollowupAt : input.nextFollowupAt,
    coverLetter: input.coverLetter === undefined ? before.coverLetter : input.coverLetter,
    resumeVariantId: input.resumeVariantId === undefined ? before.resumeVariantId : input.resumeVariantId,
    appliedAt: status === "applied" && before.appliedAt === null ? now : before.appliedAt,
    updatedAt: now,
  }).where(eq(applications.id, input.id)).returning().get()!;
  if (status !== before.status) {
    appendEvent({
      applicationId: input.id,
      type: "status_change",
      payload: { from: before.status, to: status },
      database,
      now,
    });
  }
  if (input.nextFollowupAt !== undefined && input.nextFollowupAt?.valueOf() !== before.nextFollowupAt?.valueOf()) {
    appendEvent({
      applicationId: input.id,
      type: "followup",
      payload: { nextFollowupAt: input.nextFollowupAt?.toISOString() ?? null },
      database,
      now,
    });
  }
  return after;
}

export function listApplications(
  options: { status?: ApplicationStatus; database?: JobHuntDatabase } = {},
): ApplicationWithJob[] {
  const database = options.database ?? db;
  const query = database.select({ application: applications, job: jobs, company: companies })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .orderBy(asc(applications.nextFollowupAt), desc(applications.updatedAt));
  const rows = options.status ? query.where(eq(applications.status, options.status)).all() : query.all();
  return rows.map(({ application, job, company }) => ({ ...application, job, company }));
}

export function listDueFollowups(
  now = new Date(),
  database: JobHuntDatabase = db,
): ApplicationWithJob[] {
  return database.select({ application: applications, job: jobs, company: companies })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(lte(applications.nextFollowupAt, now), isNull(applications.appliedAt)))
    .orderBy(asc(applications.nextFollowupAt))
    .all()
    .map(({ application, job, company }) => ({ ...application, job, company }));
}

export function listEvents(applicationId: number, database: JobHuntDatabase = db): Event[] {
  return database.select().from(events).where(eq(events.applicationId, applicationId)).orderBy(desc(events.occurredAt)).all();
}

export function funnelStats(database: JobHuntDatabase = db): Array<{ status: string; count: number }> {
  const counts = database.select({ status: applications.status, count: applications.id }).from(applications).all();
  const byStatus = new Map<string, number>();
  counts.forEach((row) => byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1));
  return applicationStatuses.map((status) => ({ status, count: byStatus.get(status) ?? 0 }));
}

export function saveContact(input: {
  companyId: number;
  name?: string | null;
  role?: string | null;
  email?: string | null;
  linkedin?: string | null;
  notes?: string | null;
  database?: JobHuntDatabase;
  now?: Date;
}): Contact {
  const database = input.database ?? db;
  return database.insert(contacts).values({
    companyId: input.companyId,
    name: input.name?.trim() || null,
    role: input.role?.trim() || null,
    email: input.email?.trim() || null,
    linkedin: input.linkedin?.trim() || null,
    notes: input.notes?.trim() || null,
    createdAt: input.now ?? new Date(),
  }).returning().get()!;
}

export function listContacts(database: JobHuntDatabase = db) {
  return database.select({ contact: contacts, company: companies })
    .from(contacts)
    .innerJoin(companies, eq(contacts.companyId, companies.id))
    .orderBy(asc(companies.name), asc(contacts.name))
    .all();
}
