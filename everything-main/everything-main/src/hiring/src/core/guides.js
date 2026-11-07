/**
 * Interview guides: the questions behind an interview.
 *
 * The app was opinionated about judging an interview — rating dimensions,
 * a recommendation, a panel leaning — and said nothing about conducting
 * one, so every interviewer improvised and the scorecards compared answers
 * to different questions. A guide is a named, ordered list of questions,
 * each optionally feeding one of the rating dimensions the scorecard asks
 * about, and it can attach itself to an interview format or a pipeline
 * stage so scheduling a screen picks the screen guide by itself.
 *
 * Nothing is shipped: an account starts with no guides, and writes the
 * ones it actually uses.
 */

import { isSafeId } from '../lib/id.js';
import { INTERVIEW_TYPES } from './interviews.js';

export const MAX_GUIDES = 12;
export const MAX_GUIDE_NAME = 80;
export const MAX_GUIDE_QUESTIONS = 20;
export const MAX_QUESTION_TEXT = 300;
export const MAX_GUIDE_ANSWER = 2000;

const trim = (value, max) => String(value ?? '').trim().slice(0, max);

/** Clean a stored guide list: safe ids, named, with real questions. */
export function normalizeGuides(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const id = String(entry?.id ?? '');
    const name = trim(entry?.name, MAX_GUIDE_NAME);
    if (!isSafeId(id) || !name || seen.has(id)) continue;
    const questions = [];
    const seenQuestions = new Set();
    for (const q of Array.isArray(entry.questions) ? entry.questions : []) {
      const qid = String(q?.id ?? '');
      const text = trim(q?.text, MAX_QUESTION_TEXT);
      if (!isSafeId(qid) || !text || seenQuestions.has(qid)) continue;
      seenQuestions.add(qid);
      // `field` ties the question to a rating dimension; it is a rubric key
      // and may point at a dimension a given job does not use, which the
      // scorecard editor handles by showing the question on its own.
      const field = String(q?.field ?? '');
      questions.push({ id: qid, text, ...(isSafeId(field) ? { field } : {}) });
      if (questions.length >= MAX_GUIDE_QUESTIONS) break;
    }
    if (questions.length === 0) continue;
    seen.add(id);
    out.push({
      id,
      name,
      questions,
      types: [...new Set((Array.isArray(entry.types) ? entry.types : []).filter((t) => INTERVIEW_TYPES.some((i) => i.value === t)))],
      stages: [...new Set((Array.isArray(entry.stages) ? entry.stages : []).map(String).filter((s) => isSafeId(s)))],
    });
    if (out.length >= MAX_GUIDES) break;
  }
  return out;
}

export function guidesFrom(settings) {
  return normalizeGuides(settings?.guides);
}

export function findGuide(settings, id) {
  return id ? (guidesFrom(settings).find((g) => g.id === id) ?? null) : null;
}

/**
 * The guide an interview should open with: the best match on format and
 * stage, format weighing more (a phone screen is a phone screen wherever
 * the candidate sits in the pipeline). Null when nothing matches, which
 * is every account that has written no guides.
 */
export function defaultGuideFor(settings, { type = '', stage = '' } = {}) {
  let best = null;
  let bestScore = 0;
  for (const guide of guidesFrom(settings)) {
    const score = (type && guide.types.includes(type) ? 2 : 0) + (stage && guide.stages.includes(stage) ? 1 : 0);
    if (score > bestScore) {
      best = guide;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Clean the answers snapshotted onto a scorecard. They carry the question
 * text, not a reference to it: editing a guide later must never rewrite
 * feedback already written, the same reason scorecards snapshot the rubric
 * they were rated against.
 */
export function normalizeGuideAnswers(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const entry of value) {
    const question = trim(entry?.question, MAX_QUESTION_TEXT);
    const answer = trim(entry?.answer, MAX_GUIDE_ANSWER);
    if (!question || !answer) continue;
    const field = String(entry?.field ?? '');
    out.push({ question, answer, ...(isSafeId(field) ? { field } : {}) });
    if (out.length >= MAX_GUIDE_QUESTIONS) break;
  }
  return out.length > 0 ? out : null;
}

/** How a guide's coverage reads in a list: "Phone screen · Screening". */
export function guideAppliesText(guide, stageLabelFor = (key) => key) {
  const types = guide.types.map((t) => INTERVIEW_TYPES.find((i) => i.value === t)?.label ?? t);
  const stages = guide.stages.map((s) => stageLabelFor(s));
  const all = [...types, ...stages];
  return all.length > 0 ? all.join(' · ') : 'Picked by hand';
}
