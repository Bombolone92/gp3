/**
 * Screening questions: the per-job questions the public apply form asks,
 * and the answers snapshotted onto the candidate who answered them.
 *
 * Answers are stored with the question's label, not its id: a job's
 * questions keep being edited, and feedback already received must keep
 * reading the way it was asked — the same reason scorecards snapshot the
 * rubric they were rated against.
 */

import { isSafeId } from '../lib/id.js';

export const SCREENING_KINDS = [
  { value: 'short', label: 'Short text' },
  { value: 'long', label: 'Long text' },
  { value: 'yesno', label: 'Yes / no' },
  { value: 'choice', label: 'One of a few options' },
];

export const MAX_SCREENING_QUESTIONS = 8;
export const MAX_SCREENING_OPTIONS = 6;
export const MAX_QUESTION_LENGTH = 160;
export const MAX_ANSWER_LENGTH = 1000;

export function screeningKindInfo(value) {
  return SCREENING_KINDS.find((k) => k.value === value) ?? SCREENING_KINDS[0];
}

/**
 * Clean a stored question list: safe stable ids, non-empty labels, known
 * kinds, choices with at least one option. Returns null when nothing
 * usable remains, which callers read as "this job asks nothing extra".
 */
export function normalizeScreeningQuestions(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const id = String(entry?.id ?? '');
    const label = String(entry?.label ?? '').trim().slice(0, MAX_QUESTION_LENGTH);
    if (!isSafeId(id) || !label || seen.has(id)) continue;
    const kind = SCREENING_KINDS.some((k) => k.value === entry?.kind) ? entry.kind : 'short';
    const options =
      kind === 'choice'
        ? [...new Set((Array.isArray(entry.options) ? entry.options : []).map((o) => String(o).trim()).filter(Boolean))].slice(
            0,
            MAX_SCREENING_OPTIONS
          )
        : [];
    // A choice with nothing to choose from would render an empty select on
    // the public page; there is no useful way to ask it.
    if (kind === 'choice' && options.length === 0) continue;
    seen.add(id);
    out.push({
      id,
      label,
      kind,
      required: Boolean(entry.required),
      // "Must be yes" is a yes/no notion; on any other kind there is
      // nothing to compare an answer against.
      ...(kind === 'yesno' && entry.mustHave ? { mustHave: true } : {}),
      ...(options.length > 0 ? { options } : {}),
    });
    if (out.length >= MAX_SCREENING_QUESTIONS) break;
  }
  return out.length > 0 ? out : null;
}

/** The questions a job asks; an empty list when it asks none. */
export function screeningQuestionsForJob(job) {
  return normalizeScreeningQuestions(job?.screeningQuestions) ?? [];
}

/**
 * Clean an answer list, as parsed out of an application email or carried
 * in a restored backup: labelled, non-empty, capped. Returns null when
 * nothing usable remains so records stay free of empty arrays.
 */
export function normalizeAnswers(value) {
  if (!Array.isArray(value)) return null;
  const out = [];
  for (const entry of value) {
    const label = String(entry?.label ?? '').trim().slice(0, MAX_QUESTION_LENGTH);
    const answer = String(entry?.answer ?? '').trim().slice(0, MAX_ANSWER_LENGTH);
    if (!label || !answer) continue;
    out.push({ label, answer });
    if (out.length >= MAX_SCREENING_QUESTIONS) break;
  }
  return out.length > 0 ? out : null;
}

const labelKey = (label) => String(label ?? '').trim().toLowerCase();

export function isYesAnswer(answer) {
  return /^(yes|y|true)$/i.test(String(answer ?? '').trim());
}

/** The candidate's answer to one question, matched by label, or null. */
export function answerFor(candidate, question) {
  const key = labelKey(question?.label);
  return (candidate?.answers ?? []).find((a) => labelKey(a.label) === key)?.answer ?? null;
}

/**
 * Must-have questions this candidate answered with something other than
 * yes. A flag, never a filter: the app shows it and a human decides.
 * An unanswered question is not a mismatch — nothing was said either way.
 */
export function screeningMismatches(candidate, job) {
  return screeningQuestionsForJob(job)
    .filter((q) => q.mustHave)
    .filter((q) => {
      const answer = answerFor(candidate, q);
      return answer !== null && !isYesAnswer(answer);
    });
}
