/**
 * Survey runtime: what a respondent is shown and what counts as a valid
 * answer. Used in three places that must agree exactly:
 *
 *   - the respondent page (r/index.html) and the in-app preview, to decide
 *     which questions and pages to show and to check answers as people type;
 *   - the collector worker (src/worker/collector.js), which re-checks every
 *     submitted response against the published survey before storing it.
 *
 * The worker is deployed as one plain script, so this file has no imports and
 * nothing here may touch the DOM. buildWorkerSource() in
 * src/data/collector-client.js strips the `export` keywords and prepends this
 * file to the worker source.
 *
 * Answer shapes, by question type:
 *   single, dropdown   { c: choiceId, t?: otherText }
 *   multi              { c: [choiceId, ...], t?: otherText }
 *   rating, nps,
 *   slider             number
 *   matrix             { [rowId]: columnId }  or { [rowId]: [columnId, ...] } when q.multi
 *   ranking            [choiceId, ...]  (every choice, best first)
 *   text, textarea,
 *   datetime           string
 *   multitext, contact { [fieldId]: string }
 */

export const OTHER_ID = '_other';
export const NONE_ID = '_none';

/** Types that collect an answer. 'statement' is display-only text. */
export const ANSWER_TYPES = [
  'single',
  'multi',
  'dropdown',
  'rating',
  'nps',
  'matrix',
  'slider',
  'ranking',
  'text',
  'textarea',
  'multitext',
  'contact',
  'datetime',
];

export const LIMITS = {
  text: 1000,
  textarea: 10000,
  other: 1000,
  field: 500,
};

export const CONTACT_FIELDS = [
  ['name', 'Name'],
  ['company', 'Company'],
  ['address', 'Address'],
  ['address2', 'Address 2'],
  ['city', 'City/Town'],
  ['state', 'State/Province'],
  ['zip', 'ZIP/Postal code'],
  ['country', 'Country'],
  ['email', 'Email address'],
  ['phone', 'Phone number'],
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+()\-.\s\d]{5,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isAnswerable(q) {
  return !!q && ANSWER_TYPES.includes(q.type);
}

function own(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

function choiceIds(q) {
  return (q.choices || []).map((c) => c.id);
}

/** A finite number from a number or a numeric string, else null. */
function numeric(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(raw)) return Number(raw);
  return null;
}

/** YYYY-MM-DD that names a day that exists (no February 31st). */
function realDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function clip(v, cap) {
  return typeof v === 'string' ? v.slice(0, cap) : '';
}

/** Highest value a rating question accepts. */
export function ratingMax(q) {
  const n = Math.round(Number(q.scale));
  return n >= 2 && n <= 10 ? n : 5;
}

export function sliderBounds(q) {
  let min = Number.isFinite(Number(q.min)) ? Number(q.min) : 0;
  let max = Number.isFinite(Number(q.max)) ? Number(q.max) : 100;
  if (max <= min) max = min + 1;
  let step = Number(q.step);
  if (!(step > 0)) step = 1;
  return { min, max, step };
}

/** The fields a multitext or contact question shows, in order. */
export function fieldsOf(q) {
  if (q.type === 'contact') {
    const conf = q.fields || {};
    return CONTACT_FIELDS.filter(([id]) => (own(conf, id) ? conf[id].enabled !== false : true)).map(
      ([id, label]) => ({
        id,
        label: (own(conf, id) && conf[id].label) || label,
        required: own(conf, id) ? !!conf[id].required : false,
        kind: id === 'email' ? 'email' : id === 'phone' ? 'phone' : 'text',
      }),
    );
  }
  return (q.fields || []).map((f) => ({ id: f.id, label: f.label || '', required: false, kind: 'text' }));
}

/**
 * Normalize a raw answer into its stored shape, dropping anything that does
 * not belong to the question (unknown choice ids, out-of-range numbers,
 * oversized text). Returns undefined for "no answer".
 */
export function sanitizeAnswer(q, raw) {
  if (!isAnswerable(q) || raw == null) return undefined;
  switch (q.type) {
    case 'single':
    case 'dropdown': {
      const c = typeof raw === 'object' ? raw.c : raw;
      if (typeof c !== 'string') return undefined;
      if (c === OTHER_ID && q.other && q.other.enabled) {
        const t = clip(raw.t, LIMITS.other).trim();
        return t ? { c, t } : { c };
      }
      return choiceIds(q).includes(c) ? { c } : undefined;
    }
    case 'multi': {
      const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.c) ? raw.c : null;
      if (!list) return undefined;
      const allowed = new Set(choiceIds(q));
      if (q.other && q.other.enabled) allowed.add(OTHER_ID);
      if (q.none && q.none.enabled) allowed.add(NONE_ID);
      let picked = [...new Set(list.filter((c) => typeof c === 'string' && allowed.has(c)))];
      if (picked.includes(NONE_ID)) picked = [NONE_ID];
      if (!picked.length) return undefined;
      const out = { c: picked };
      if (picked.includes(OTHER_ID)) {
        const t = clip(raw.t, LIMITS.other).trim();
        if (t) out.t = t;
      }
      return out;
    }
    case 'rating': {
      const n = numeric(raw);
      return Number.isInteger(n) && n >= 1 && n <= ratingMax(q) ? n : undefined;
    }
    case 'nps': {
      const n = numeric(raw);
      return Number.isInteger(n) && n >= 0 && n <= 10 ? n : undefined;
    }
    case 'slider': {
      const n = numeric(raw);
      const { min, max, step } = sliderBounds(q);
      if (n == null || n < min || n > max) return undefined;
      // On the step grid (with a little room for floating point).
      const k = (n - min) / step;
      return Math.abs(k - Math.round(k)) < 1e-6 ? n : undefined;
    }
    case 'matrix': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
      const cols = new Set((q.columns || []).map((c) => c.id));
      const out = {};
      for (const row of q.rows || []) {
        if (!own(raw, row.id)) continue;
        const v = raw[row.id];
        if (q.multi) {
          const picked = Array.isArray(v) ? [...new Set(v.filter((c) => cols.has(c)))] : [];
          if (picked.length) out[row.id] = picked;
        } else if (typeof v === 'string' && cols.has(v)) {
          out[row.id] = v;
        }
      }
      return Object.keys(out).length ? out : undefined;
    }
    case 'ranking': {
      if (!Array.isArray(raw)) return undefined;
      const ids = choiceIds(q);
      const order = [...new Set(raw.filter((c) => ids.includes(c)))];
      return order.length === ids.length && ids.length > 0 ? order : undefined;
    }
    case 'text':
    case 'textarea': {
      const t = clip(raw, q.type === 'text' ? LIMITS.text : LIMITS.textarea);
      return t.trim() ? t : undefined;
    }
    case 'datetime': {
      const t = typeof raw === 'string' ? raw.trim() : '';
      if (!t) return undefined;
      const wantDate = q.date !== false;
      const wantTime = !!q.time;
      if (wantDate && wantTime) {
        const [d, tm] = t.split('T');
        return realDate(d) && TIME_RE.test(tm || '') ? `${d}T${tm}` : undefined;
      }
      if (wantTime) return TIME_RE.test(t) ? t : undefined;
      return realDate(t) ? t : undefined;
    }
    case 'multitext':
    case 'contact': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
      const out = {};
      for (const f of fieldsOf(q)) {
        const t = clip(raw[f.id], LIMITS.field).trim();
        if (t) out[f.id] = t;
      }
      return Object.keys(out).length ? out : undefined;
    }
    default:
      return undefined;
  }
}

function countLabel(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** What an unanswered required question says unless the creator wrote
 *  their own message. */
export function defaultRequiredMessage(q) {
  // A ranking starts out in an order, so say how to answer it.
  return q && q.type === 'ranking' ? 'Put the items in order, or choose “Keep this order”.' : 'This question requires an answer.';
}

/**
 * The message to show for an answer, or '' when it is acceptable. `value`
 * must already be sanitized (undefined = unanswered).
 */
export function validateAnswer(q, value) {
  if (!isAnswerable(q)) return '';
  const requiredMsg = (q.requiredMessage || '').trim() || defaultRequiredMessage(q);
  if (value === undefined) {
    if (q.required) return requiredMsg;
    // Contact fields marked required (shown with *) are required even when
    // the question as a whole is not.
    const field = q.type === 'contact' && fieldsOf(q).find((f) => f.required);
    return field ? `${field.label} is required.` : '';
  }

  switch (q.type) {
    case 'single':
    case 'dropdown':
      if (value.c === OTHER_ID && q.other && q.other.required !== false && !value.t) {
        return 'Please specify your answer.';
      }
      return '';
    case 'multi': {
      const real = value.c.filter((c) => c !== NONE_ID);
      if (value.c.includes(OTHER_ID) && q.other && q.other.required !== false && !value.t) {
        return 'Please specify your answer.';
      }
      if (value.c.includes(NONE_ID)) return '';
      const min = Number(q.minSelect) || 0;
      const max = Number(q.maxSelect) || 0;
      if (min && max && min === max && real.length !== min) {
        return `Select exactly ${countLabel(min, 'option', 'options')}.`;
      }
      if (min && real.length < min) return `Select at least ${countLabel(min, 'option', 'options')}.`;
      if (max && real.length > max) return `Select no more than ${countLabel(max, 'option', 'options')}.`;
      return '';
    }
    case 'matrix':
      if (q.required && (q.rows || []).some((r) => !own(value, r.id))) {
        return (q.requiredMessage || '').trim() || 'Please answer every row.';
      }
      return '';
    case 'text': {
      const v = q.validation || {};
      const t = value.trim();
      if (v.kind === 'email' && !EMAIL_RE.test(t)) return v.message || 'Enter a valid email address.';
      if (v.kind === 'number' || v.kind === 'integer') {
        // Plain decimal digits only: Number() would also take hex, binary,
        // exponents and Infinity, which are stored as typed.
        // A decimal comma counts ("3,5": phone keypads in many languages
        // offer only that), except where it could be a thousands separator
        // ("1,000").
        const comma = /^[+-]?\d*,\d+$/.test(t) && !/^[+-]?\d{1,3},\d{3}$/.test(t);
        const n = Number(comma ? t.replace(',', '.') : t);
        const bad =
          !(comma || /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) ||
          !Number.isFinite(n) ||
          (v.kind === 'integer' && !Number.isInteger(n)) ||
          (v.min !== '' && v.min != null && n < Number(v.min)) ||
          (v.max !== '' && v.max != null && n > Number(v.max));
        if (bad) {
          if (v.message) return v.message;
          const kind = v.kind === 'integer' ? 'a whole number' : 'a number';
          const hasMin = v.min !== '' && v.min != null;
          const hasMax = v.max !== '' && v.max != null;
          if (hasMin && hasMax) return `Enter ${kind} between ${v.min} and ${v.max}.`;
          if (hasMin) return `Enter ${kind} of at least ${v.min}.`;
          if (hasMax) return `Enter ${kind} of at most ${v.max}.`;
          return `Enter ${kind}.`;
        }
      }
      if (v.kind === 'length') {
        const min = Number(v.min) || 0;
        const max = Number(v.max) || 0;
        if ((min && t.length < min) || (max && t.length > max)) {
          if (v.message) return v.message;
          if (min && max) return `Enter between ${min} and ${max} characters.`;
          if (min) return `Enter at least ${countLabel(min, 'character', 'characters')}.`;
          return `Enter no more than ${countLabel(max, 'character', 'characters')}.`;
        }
      }
      return '';
    }
    case 'textarea': {
      const v = q.validation || {};
      if (v.kind === 'length') {
        const t = value.trim();
        const min = Number(v.min) || 0;
        const max = Number(v.max) || 0;
        if (min && t.length < min) return v.message || `Enter at least ${countLabel(min, 'character', 'characters')}.`;
        if (max && t.length > max) return v.message || `Enter no more than ${countLabel(max, 'character', 'characters')}.`;
      }
      return '';
    }
    case 'contact':
    case 'multitext': {
      const issue = fieldIssue(q, value);
      return issue ? issue.message : '';
    }
    default:
      return '';
  }
}

/**
 * The first box of a contact or multiple-text answer that fails, as
 * { id, message }, or null.
 */
export function fieldIssue(q, value) {
  for (const f of fieldsOf(q)) {
    const t = value[f.id];
    if (q.type === 'contact') {
      if (f.required && !t) return { id: f.id, message: `${f.label} is required.` };
      if (t && f.kind === 'email' && !EMAIL_RE.test(t)) return { id: f.id, message: 'Enter a valid email address.' };
      if (t && f.kind === 'phone' && !PHONE_RE.test(t)) return { id: f.id, message: 'Enter a valid phone number.' };
    } else if (q.required && !t) return { id: f.id, message: 'Please fill in every box.' };
  }
  return null;
}

/** True when a display condition holds for the answers given so far. */
export function conditionHolds(cond, survey, answers) {
  if (!cond || !cond.qid) return true;
  const value = answers ? answers[cond.qid] : undefined;
  const answered = value !== undefined;
  switch (cond.op) {
    case 'answered':
      return answered;
    case 'notAnswered':
      return !answered;
    case 'is':
    case 'isNot': {
      let hit = false;
      if (value != null && typeof value === 'object' && !Array.isArray(value)) {
        hit = Array.isArray(value.c) ? value.c.includes(cond.value) : value.c === cond.value;
      } else if (typeof value === 'number') {
        hit = String(value) === String(cond.value);
      }
      return cond.op === 'is' ? hit : answered && !hit;
    }
    default:
      return true;
  }
}

export function isQuestionVisible(q, survey, answers) {
  return conditionHolds(q.display, survey, answers);
}

/**
 * Where to go after `pageIndex`: another page index, 'end' (thank-you
 * screen), or 'disqualify'. Question skip logic on the page wins over page
 * logic, earliest question first; only visible, answered single-answer
 * questions take part.
 */
export function nextStep(survey, pageIndex, answers) {
  const pages = survey.pages || [];
  const page = pages[pageIndex];
  const resolve = (target) => {
    if (!target || !target.type) return null;
    if (target.type === 'end' || target.type === 'disqualify') return target.type;
    if (target.type === 'page') {
      const idx = pages.findIndex((p) => p.id === target.pageId);
      // Only ever jump forward: a backwards jump could loop forever.
      if (idx > pageIndex) return idx;
    }
    return null;
  };
  if (page) {
    for (const q of page.questions || []) {
      if (!q.logic || !isQuestionVisible(q, survey, answers)) continue;
      const v = answers ? answers[q.id] : undefined;
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      // Checkbox picks arrive in screen order, which is shuffled when choices
      // are randomized: rules apply in the order the choices were written.
      const picked = new Set(Array.isArray(v.c) ? v.c : [v.c]);
      const order = [...(q.choices || []).map((c) => c.id), OTHER_ID, NONE_ID];
      for (const c of order.filter((id) => picked.has(id))) {
        if (!own(q.logic, c)) continue;
        const to = resolve(q.logic[c]);
        if (to != null) return to;
      }
    }
    const to = resolve(page.logic);
    if (to != null) return to;
  }
  return pageIndex + 1 < pages.length ? pageIndex + 1 : 'end';
}

/** The pages a respondent with these answers walks through, in order, and
 *  how the walk ends. */
export function walk(survey, answers) {
  const pages = survey.pages || [];
  const path = [];
  if (!pages.length) return { path, outcome: 'end' };
  let i = 0;
  const seen = new Set();
  while (typeof i === 'number' && i < pages.length && !seen.has(i)) {
    seen.add(i);
    path.push(i);
    i = nextStep(survey, i, answers);
  }
  return { path, outcome: i === 'disqualify' ? 'disqualify' : 'end' };
}

/**
 * Check a whole submission the way the collector does: sanitize every
 * answer, drop answers to questions the respondent never saw (skipped pages,
 * hidden questions), and report the first problem per question.
 */
export function validateResponse(survey, rawAnswers) {
  const raw = rawAnswers && typeof rawAnswers === 'object' ? rawAnswers : {};
  const pages = survey.pages || [];
  // Answers are accepted page by page along the path, and only for
  // questions visible at that point, so an answer to a skipped or hidden
  // question can never steer logic, hide a required question, or be stored.
  // Null-prototype maps: a question id is never mistaken for an inherited
  // property.
  const clean = Object.create(null);
  const errors = Object.create(null);
  const path = [];
  const seen = new Set();
  let i = pages.length ? 0 : 'end';
  while (typeof i === 'number' && i < pages.length && !seen.has(i)) {
    seen.add(i);
    path.push(i);
    for (const q of pages[i].questions || []) {
      if (!isAnswerable(q) || !isQuestionVisible(q, survey, clean)) continue;
      const v = own(raw, q.id) ? sanitizeAnswer(q, raw[q.id]) : undefined;
      if (v !== undefined) clean[q.id] = v;
      const msg = validateAnswer(q, v);
      if (msg) errors[q.id] = msg;
    }
    i = nextStep(survey, i, clean);
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors: { ...errors },
    answers: { ...clean },
    outcome: i === 'disqualify' ? 'disqualify' : 'end',
    path,
  };
}

/** Small deterministic PRNG so a respondent keeps the same shuffled order
 *  when they go back a page. */
export function seededShuffle(items, seed) {
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    const j = (h >>> 0) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Question numbers as respondents see them: answerable questions only,
 *  counted across the whole survey. */
export function questionNumbers(survey) {
  const out = {};
  let n = 0;
  for (const page of survey.pages || []) {
    for (const q of page.questions || []) {
      if (isAnswerable(q)) out[q.id] = ++n;
    }
  }
  return out;
}
