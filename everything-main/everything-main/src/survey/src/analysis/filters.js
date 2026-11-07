/**
 * Response filters for the Analyze step. A filter is plain data, so it can
 * be kept in sessionStorage, described as removable chips, and applied the
 * same way to summaries, the response list, and exports.
 *
 *   {
 *     collectors: [collectorId],     empty = all
 *     outcome: 'all' | 'complete' | 'disqualified',
 *     from: 'YYYY-MM-DD', to: 'YYYY-MM-DD',   local dates, inclusive
 *     devices: ['desktop' | 'tablet' | 'mobile' | 'unknown'],
 *     answers: [{ qid, value }]      every condition must hold
 *   }
 */
import { pickedIds, choiceLabel } from './answers.js';
import { questionNumbers } from '../shared/runtime.js';
import { allQuestions } from '../model/survey.js';

export const DEVICE_LABELS = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Phone', unknown: 'Unknown device' };
export const OUTCOME_LABELS = { complete: 'Completed', disqualified: 'Disqualified' };

export function emptyFilters() {
  return { collectors: [], outcome: 'all', from: '', to: '', devices: [], answers: [] };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Repair a stored or hand-edited filter object. */
export function normalizeFilters(raw) {
  const f = emptyFilters();
  if (!raw || typeof raw !== 'object') return f;
  const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  f.collectors = strs(raw.collectors);
  f.devices = strs(raw.devices);
  f.outcome = ['complete', 'disqualified'].includes(raw.outcome) ? raw.outcome : 'all';
  f.from = DATE_RE.test(raw.from || '') ? raw.from : '';
  f.to = DATE_RE.test(raw.to || '') ? raw.to : '';
  f.answers = Array.isArray(raw.answers)
    ? raw.answers.filter((a) => a && typeof a.qid === 'string' && a.value != null).map((a) => ({ qid: a.qid, value: String(a.value) }))
    : [];
  return f;
}

export function isFiltered(f) {
  return !!(f.collectors.length || f.devices.length || f.outcome !== 'all' || f.from || f.to || f.answers.length);
}

/** Local midnight starting date `s` (YYYY-MM-DD), or `days` later. */
function localDayStart(s, days = 0) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d + days).getTime();
}

/** Whether a stored answer matches "is <value>" (a choice id, or a number
 *  for rating and 0-10 questions). */
export function answerMatches(value, wanted) {
  if (value == null) return false;
  if (typeof value === 'number') return String(value) === wanted;
  return pickedIds(value).includes(wanted);
}

export function makePredicate(f) {
  const cols = f.collectors.length ? new Set(f.collectors) : null;
  const devs = f.devices.length ? new Set(f.devices) : null;
  const from = f.from ? localDayStart(f.from) : -Infinity;
  // "to" is inclusive: everything before the next day's midnight (not 24
  // hours on: days when clocks change are 23 or 25 hours long).
  const to = f.to ? localDayStart(f.to, 1) : Infinity;
  return (r) => {
    if (cols && !cols.has(r.cid)) return false;
    if (devs && !devs.has((r.meta && r.meta.device) || 'unknown')) return false;
    if (f.outcome !== 'all' && (r.outcome || 'complete') !== f.outcome) return false;
    if (!(r.at >= from && r.at < to)) return false;
    for (const a of f.answers) if (!answerMatches(r.answers && r.answers[a.qid], a.value)) return false;
    return true;
  };
}

export function applyFilters(responses, f) {
  if (!isFiltered(f)) return responses;
  return responses.filter(makePredicate(f));
}

/** Questions an answer filter can test, with the values it can pick. */
export function filterableQuestions(survey) {
  const nums = questionNumbers(survey);
  const out = [];
  for (const q of allQuestions(survey)) {
    let values = null;
    if (['single', 'multi', 'dropdown'].includes(q.type)) {
      values = (q.choices || []).filter((c) => (c.label || '').trim()).map((c) => ({ value: c.id, label: c.label }));
      if (q.other && q.other.enabled) values.push({ value: '_other', label: choiceLabel(q, '_other') });
      if (q.none && q.none.enabled) values.push({ value: '_none', label: choiceLabel(q, '_none') });
    } else if (q.type === 'rating') {
      const max = Math.min(10, Math.max(2, Number(q.scale) || 5));
      values = Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: `${i + 1} of ${max}` }));
    } else if (q.type === 'nps') {
      values = Array.from({ length: 11 }, (_, i) => ({ value: String(i), label: String(i) }));
    }
    if (values && values.length) out.push({ q, number: nums[q.id], values });
  }
  return out;
}

/** How a rule reads: a checkbox answer can hold several choices. */
export const ruleVerb = (q) => (q && q.type === 'multi' ? 'includes' : 'is');

/**
 * Drop answer rules whose question or answer no longer exists (deleted or
 * retyped in Design since the filter was set). Such a rule would match
 * nothing and leave the results empty for no visible reason.
 */
export function pruneFilters(f, survey) {
  const fq = filterableQuestions(survey);
  const answers = f.answers.filter((a) => {
    const info = fq.find((x) => x.q.id === a.qid);
    return info && info.values.some((v) => v.value === a.value);
  });
  return answers.length === f.answers.length ? f : { ...f, answers };
}

function fmtDay(s) {
  return new Date(localDayStart(s)).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

/**
 * The active filters as chips: { key, label }. `key` identifies the part
 * to drop with removeFilter().
 */
export function describeFilters(f, survey, collectors = {}) {
  const chips = [];
  if (f.collectors.length) {
    const names = f.collectors.map((id) => (collectors[id] && collectors[id].name) || 'Removed link');
    chips.push({ key: 'collectors', label: `Link: ${names.join(', ')}` });
  }
  if (f.outcome !== 'all') chips.push({ key: 'outcome', label: OUTCOME_LABELS[f.outcome] });
  if (f.from && f.to) chips.push({ key: 'dates', label: `${fmtDay(f.from)} to ${fmtDay(f.to)}` });
  else if (f.from) chips.push({ key: 'dates', label: `From ${fmtDay(f.from)}` });
  else if (f.to) chips.push({ key: 'dates', label: `Until ${fmtDay(f.to)}` });
  if (f.devices.length) chips.push({ key: 'devices', label: f.devices.map((d) => DEVICE_LABELS[d] || d).join(', ') });
  const fq = new Map(filterableQuestions(survey).map((x) => [x.q.id, x]));
  f.answers.forEach((a, i) => {
    const info = fq.get(a.qid);
    const valueLabel = info ? (info.values.find((v) => v.value === a.value) || {}).label || 'removed answer' : 'removed answer';
    const qLabel = info ? `Q${info.number}` : 'Removed question';
    chips.push({ key: `answer:${i}`, label: `${qLabel} ${ruleVerb(info && info.q)} ${valueLabel}` });
  });
  return chips;
}

export function removeFilter(f, key) {
  const next = { ...f, answers: f.answers.slice() };
  if (key === 'collectors') next.collectors = [];
  else if (key === 'outcome') next.outcome = 'all';
  else if (key === 'dates') {
    next.from = '';
    next.to = '';
  } else if (key === 'devices') next.devices = [];
  else if (key.startsWith('answer:')) next.answers.splice(Number(key.slice(7)), 1);
  return next;
}
