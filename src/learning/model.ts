import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { applications, matches, rankingFeedback, triage } from "@/db/schema";
import type { JobHuntDatabase } from "@/db/types";

export const positiveOutcomes = ["interested", "applied", "responded", "screen", "interview", "offer"] as const;
export const negativeOutcomes = ["skip", "rejected", "ghosted", "withdrawn"] as const;

export type FeatureVector = {
  lexical: number;
  feature: number;
  retrieval: number;
  llm: number;
};

export interface LogisticModel {
  intercept: number;
  weights: FeatureVector;
  examples: number;
}

function labelFor(outcome: string): number | null {
  if (positiveOutcomes.includes(outcome as (typeof positiveOutcomes)[number])) return 1;
  if (negativeOutcomes.includes(outcome as (typeof negativeOutcomes)[number])) return 0;
  return null;
}

function vectorFromMatch(match: { lexicalScore: number; featureScore: number; retrievalScore: number; llmScore: number | null }): FeatureVector {
  return {
    lexical: match.lexicalScore,
    feature: match.featureScore,
    retrieval: match.retrievalScore,
    llm: (match.llmScore ?? Math.round(match.retrievalScore * 100)) / 100,
  };
}

function dot(weights: FeatureVector, input: FeatureVector): number {
  return weights.lexical * input.lexical + weights.feature * input.feature + weights.retrieval * input.retrieval + weights.llm * input.llm;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
}

export function trainLogisticModel(
  examples: Array<{ outcome: string; features: FeatureVector }>,
): LogisticModel | null {
  const usable = examples.flatMap((example) => {
    const label = labelFor(example.outcome);
    return label === null ? [] : [{ label, features: example.features }];
  });
  if (usable.length < 6 || new Set(usable.map((example) => example.label)).size < 2) return null;
  let intercept = 0;
  const weights: FeatureVector = { lexical: 0, feature: 0, retrieval: 0, llm: 0 };
  for (let step = 0; step < 600; step += 1) {
    const gradient = { intercept: 0, lexical: 0, feature: 0, retrieval: 0, llm: 0 };
    for (const example of usable) {
      const error = sigmoid(intercept + dot(weights, example.features)) - example.label;
      gradient.intercept += error;
      gradient.lexical += error * example.features.lexical;
      gradient.feature += error * example.features.feature;
      gradient.retrieval += error * example.features.retrieval;
      gradient.llm += error * example.features.llm;
    }
    const learningRate = 0.25 / usable.length;
    intercept -= gradient.intercept * learningRate;
    weights.lexical -= gradient.lexical * learningRate;
    weights.feature -= gradient.feature * learningRate;
    weights.retrieval -= gradient.retrieval * learningRate;
    weights.llm -= gradient.llm * learningRate;
  }
  return { intercept, weights, examples: usable.length };
}

export function predictLearnedScore(model: LogisticModel, features: FeatureVector): number {
  return sigmoid(model.intercept + dot(model.weights, features)) * 100;
}

function featuresForMatch(match: typeof matches.$inferSelect): FeatureVector {
  return vectorFromMatch(match);
}

/** Convert new application and triage outcomes into durable labelled examples. */
export function syncOutcomeFeedback(profileId: number, database: JobHuntDatabase = db, now = new Date()): number {
  const existing = new Set(database.select({ jobId: rankingFeedback.jobId, outcome: rankingFeedback.outcome }).from(rankingFeedback).where(eq(rankingFeedback.profileId, profileId)).all().map((row) => `${row.jobId}:${row.outcome}`));
  const candidates: Array<{ jobId: number; outcome: string; match: typeof matches.$inferSelect }> = [];
  for (const row of database.select({ application: applications, match: matches }).from(applications).innerJoin(matches, and(eq(applications.jobId, matches.jobId), eq(matches.profileId, profileId))).all()) {
    if (labelFor(row.application.status) !== null) candidates.push({ jobId: row.application.jobId, outcome: row.application.status, match: row.match });
  }
  for (const row of database.select({ triage: triage, match: matches }).from(triage).innerJoin(matches, and(eq(triage.jobId, matches.jobId), eq(matches.profileId, profileId))).all()) {
    if (labelFor(row.triage.decision) !== null) candidates.push({ jobId: row.triage.jobId, outcome: row.triage.decision, match: row.match });
  }
  let inserted = 0;
  for (const candidate of candidates) {
    const key = `${candidate.jobId}:${candidate.outcome}`;
    if (existing.has(key)) continue;
    existing.add(key);
    const features = featuresForMatch(candidate.match);
    database.insert(rankingFeedback).values({
      jobId: candidate.jobId,
      profileId,
      outcome: candidate.outcome,
      features,
      retrievalScore: candidate.match.retrievalScore,
      llmScore: candidate.match.llmScore,
      createdAt: now,
    }).run();
    inserted += 1;
  }
  return inserted;
}

export function blendLearnedScores(profileId: number, database: JobHuntDatabase = db): { model: LogisticModel | null; updated: number } {
  const examples = database.select().from(rankingFeedback).where(eq(rankingFeedback.profileId, profileId)).all().map((row) => ({
    outcome: row.outcome,
    features: {
      lexical: row.features.lexical ?? 0,
      feature: row.features.feature ?? 0,
      retrieval: row.features.retrieval ?? row.retrievalScore,
      llm: row.features.llm ?? (row.llmScore ?? Math.round(row.retrievalScore * 100)) / 100,
    },
  }));
  const model = trainLogisticModel(examples);
  if (!model) return { model: null, updated: 0 };
  const rows = database.select().from(matches).where(eq(matches.profileId, profileId)).all();
  for (const row of rows) {
    database.update(matches).set({ learnedScore: predictLearnedScore(model, featuresForMatch(row)) }).where(and(eq(matches.jobId, row.jobId), eq(matches.profileId, profileId))).run();
  }
  return { model, updated: rows.length };
}

export function runLearning(profileId: number, database: JobHuntDatabase = db, now = new Date()) {
  const inserted = syncOutcomeFeedback(profileId, database, now);
  const blended = blendLearnedScores(profileId, database);
  return { inserted, ...blended };
}
