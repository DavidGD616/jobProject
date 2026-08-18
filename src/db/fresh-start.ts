import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";

import { db } from "./client";
import {
  applicationRuns,
  applications,
  events,
  matches,
  rankingFeedback,
  resumeVariants,
  tailorRequests,
  triage,
} from "./schema";
import type { JobHuntDatabase } from "./types";

export interface FreshStartResumeVariant {
  id: number;
  pdfPath: string | null;
}

export interface FreshStartResult {
  applicationsCleared: number;
  applicationRunsCleared: number;
  eventsCleared: number;
  interestedTriageCleared: number;
  rankingFeedbackCleared: number;
  learnedScoresReset: number;
  tailorRequestsCleared: number;
  resumeVariants: FreshStartResumeVariant[];
}

/**
 * Clear the user's saved application workspace without touching their profile,
 * job/company catalog, or match rows. Only `interested` labels are removed;
 * skip and blocked-company decisions remain intentional preferences.
 *
 * Application runs and events must be removed with their applications because
 * their foreign keys are non-null and use SQLite's NO ACTION delete policy.
 */
export function clearFreshStartState(
  database: JobHuntDatabase = db,
): FreshStartResult {
  return database.transaction((tx) => {
    const applicationRows = tx
      .select({ id: applications.id, jobId: applications.jobId })
      .from(applications)
      .all();
    const applicationIds = applicationRows.map((application) => application.id);
    const affectedJobIds = new Set(applicationRows.map((application) => application.jobId));
    const applicationRunRows = applicationIds.length > 0
      ? tx
        .select({ id: applicationRuns.id })
        .from(applicationRuns)
        .where(inArray(applicationRuns.applicationId, applicationIds))
        .all()
      : [];
    const eventRows = applicationIds.length > 0
      ? tx
        .select({ id: events.id })
        .from(events)
        .where(inArray(events.applicationId, applicationIds))
        .all()
      : [];

    const interestedRows = tx
      .select({ id: triage.id, jobId: triage.jobId, profileId: triage.profileId })
      .from(triage)
      .where(eq(triage.decision, "interested"))
      .all();
    for (const row of interestedRows) affectedJobIds.add(row.jobId);

    const variants = tx
      .select({ id: resumeVariants.id, pdfPath: resumeVariants.pdfPath })
      .from(resumeVariants)
      .orderBy(asc(resumeVariants.id))
      .all();
    const requestRows = tx.select({ id: tailorRequests.id }).from(tailorRequests).all();

    const feedbackCondition = affectedJobIds.size > 0
      ? or(
        eq(rankingFeedback.outcome, "interested"),
        inArray(rankingFeedback.jobId, [...affectedJobIds]),
      )
      : eq(rankingFeedback.outcome, "interested");
    const feedbackRows = tx
      .select({ id: rankingFeedback.id, profileId: rankingFeedback.profileId })
      .from(rankingFeedback)
      .where(feedbackCondition)
      .all();
    const profileIdsWithResetScores = [...new Set([
      ...interestedRows.map((row) => row.profileId),
      ...feedbackRows.map((row) => row.profileId),
    ])];
    const learnedScoreRows = profileIdsWithResetScores.length > 0
      ? tx
        .select({ jobId: matches.jobId, profileId: matches.profileId })
        .from(matches)
        .where(and(
          inArray(matches.profileId, profileIdsWithResetScores),
          isNotNull(matches.learnedScore),
        ))
        .all()
      : [];

    // Delete children before their application/variant parents. Foreign keys
    // are enforced for every local connection and do not cascade in this schema.
    if (applicationIds.length > 0) {
      tx.delete(applicationRuns).where(inArray(applicationRuns.applicationId, applicationIds)).run();
      tx.delete(events).where(inArray(events.applicationId, applicationIds)).run();
      tx.delete(applications).run();
    }
    if (requestRows.length > 0) tx.delete(tailorRequests).run();
    if (variants.length > 0) tx.delete(resumeVariants).run();
    if (interestedRows.length > 0) {
      tx.delete(triage).where(eq(triage.decision, "interested")).run();
    }
    if (feedbackRows.length > 0) {
      tx.delete(rankingFeedback).where(inArray(rankingFeedback.id, feedbackRows.map((row) => row.id))).run();
    }
    if (profileIdsWithResetScores.length > 0) {
      tx
        .update(matches)
        .set({ learnedScore: null })
        .where(and(
          inArray(matches.profileId, profileIdsWithResetScores),
          isNotNull(matches.learnedScore),
        ))
        .run();
    }

    return {
      applicationsCleared: applicationRows.length,
      applicationRunsCleared: applicationRunRows.length,
      eventsCleared: eventRows.length,
      interestedTriageCleared: interestedRows.length,
      rankingFeedbackCleared: feedbackRows.length,
      learnedScoresReset: learnedScoreRows.length,
      tailorRequestsCleared: requestRows.length,
      resumeVariants: variants,
    };
  });
}
