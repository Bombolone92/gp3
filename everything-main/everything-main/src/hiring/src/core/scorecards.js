/** Scorecards: structured interview feedback and its aggregation. */

import { isSafeId } from '../lib/id.js';

export const RATING_FIELDS = [
  { key: 'skills', label: 'Role skills' },
  { key: 'experience', label: 'Experience' },
  { key: 'communication', label: 'Communication' },
  { key: 'collaboration', label: 'Collaboration' },
];

/**
 * Clean a stored rating-dimension list: safe stable keys, non-empty
 * labels, no duplicates. Returns null when nothing usable remains, which
 * callers treat as "use the default rubric".
 */
export function normalizeRatingFields(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const key = String(entry?.key ?? '');
    const label = String(entry?.label ?? '').trim();
    if (!isSafeId(key) || !label || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label });
  }
  return out.length > 0 ? out : null;
}

/** The rubric interviewers rate against for a job: its own, or the default. */
export function ratingFieldsForJob(job) {
  return normalizeRatingFields(job?.ratingFields) ?? RATING_FIELDS;
}

/**
 * The rubric a scorecard was written with. Scorecards snapshot their
 * job's dimensions at save time, so feedback keeps rendering correctly
 * after the job's rubric changes; absence means the default rubric.
 */
export function ratingFieldsForScorecard(scorecard) {
  return normalizeRatingFields(scorecard?.fields) ?? RATING_FIELDS;
}

export const RECOMMENDATIONS = [
  { value: 'strong_yes', label: 'Strong yes', score: 2 },
  { value: 'yes', label: 'Yes', score: 1 },
  { value: 'no', label: 'No', score: -1 },
  { value: 'strong_no', label: 'Strong no', score: -2 },
];

export function recommendationInfo(value) {
  return RECOMMENDATIONS.find((r) => r.value === value) ?? null;
}

export function isValidRating(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

/** Returns a list of human-readable problems; empty when valid. */
export function validateScorecard({ author, recommendation, ratings }) {
  const errors = [];
  if (!String(author ?? '').trim()) errors.push('Add the reviewer’s name.');
  if (!recommendationInfo(recommendation)) errors.push('Pick an overall recommendation.');
  for (const [key, value] of Object.entries(ratings ?? {})) {
    if (value !== null && value !== undefined && !isValidRating(value)) {
      errors.push(`Rating for ${key} must be between 1 and 5.`);
    }
  }
  return errors;
}

/** Mean of the ratings a reviewer actually filled in, or null. */
export function averageRating(scorecard) {
  // Iterate the ratings object itself, not a fixed field list: custom
  // rubrics store ratings under their own dimension keys.
  const values = Object.values(scorecard.ratings ?? {}).filter(isValidRating);
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Roll several scorecards up into one picture: per-field averages, overall
 * average, recommendation counts, and a leaning ('hire' | 'no_hire' |
 * 'split' | null) from the summed recommendation scores. `fields` names
 * the dimensions byField reports on (a job's rubric); default rubric
 * otherwise.
 */
export function summarizeScorecards(scorecards, fields = RATING_FIELDS) {
  const summary = {
    count: scorecards.length,
    average: null,
    byField: {},
    recommendations: Object.fromEntries(RECOMMENDATIONS.map((r) => [r.value, 0])),
    leaning: null,
  };
  if (scorecards.length === 0) return summary;

  for (const field of fields) {
    const values = scorecards.map((s) => s.ratings?.[field.key]).filter(isValidRating);
    summary.byField[field.key] =
      values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  }

  const averages = scorecards.map(averageRating).filter((v) => v !== null);
  summary.average =
    averages.length > 0 ? averages.reduce((a, b) => a + b, 0) / averages.length : null;

  let total = 0;
  for (const s of scorecards) {
    const rec = recommendationInfo(s.recommendation);
    if (!rec) continue;
    summary.recommendations[rec.value] += 1;
    total += rec.score;
  }
  summary.leaning = total > 0 ? 'hire' : total < 0 ? 'no_hire' : 'split';
  return summary;
}
