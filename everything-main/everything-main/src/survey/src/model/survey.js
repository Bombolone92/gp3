/**
 * The survey document: factories for every part, the question type catalog,
 * and normalize(), which turns anything loaded from storage or an import into
 * a well-formed survey (unknown fields dropped, missing ones defaulted).
 *
 * Surveys are treated as immutable values: every edit produces a new object
 * that shares untouched pages and questions with the old one, so the builder
 * can redraw only the cards that actually changed (see src/model/edit.js).
 */
import { partId, surveyId } from '../lib/ids.js';
import { CONTACT_FIELDS, OTHER_ID, NONE_ID, isAnswerable, ratingMax, fieldsOf } from '../shared/runtime.js';

export const SCHEMA_VERSION = 1;

/** Question types in the order the builder offers them. */
export const QUESTION_TYPES = [
  { type: 'single', label: 'Multiple choice', icon: 'single', hint: 'One answer from a list' },
  { type: 'multi', label: 'Checkboxes', icon: 'multi', hint: 'Any number of answers' },
  { type: 'dropdown', label: 'Dropdown', icon: 'dropdown', hint: 'One answer from a menu' },
  { type: 'rating', label: 'Star rating', icon: 'rating', hint: 'Rate on a 2 to 10 point scale' },
  { type: 'nps', label: 'Recommendation (0-10)', icon: 'nps', hint: 'How likely to recommend' },
  { type: 'matrix', label: 'Rating grid', icon: 'matrix', hint: 'Rate several items on one scale' },
  { type: 'slider', label: 'Slider', icon: 'slider', hint: 'Pick a number on a range' },
  { type: 'ranking', label: 'Ranking', icon: 'ranking', hint: 'Put items in order' },
  { type: 'text', label: 'Short answer', icon: 'text', hint: 'One line of text' },
  { type: 'textarea', label: 'Long answer', icon: 'textarea', hint: 'Paragraph of text' },
  { type: 'multitext', label: 'Multiple short answers', icon: 'multitext', hint: 'Several labeled boxes' },
  { type: 'contact', label: 'Contact details', icon: 'contact', hint: 'Name, email, address' },
  { type: 'datetime', label: 'Date and time', icon: 'datetime', hint: 'A date, a time, or both' },
  { type: 'statement', label: 'Text block', icon: 'statement', hint: 'Instructions, no answer' },
];

export const TYPE_BY_ID = Object.fromEntries(QUESTION_TYPES.map((t) => [t.type, t]));

/** Types whose answers are picked from q.choices. */
export const CHOICE_TYPES = ['single', 'multi', 'dropdown', 'ranking'];

/** Types that can carry per-answer skip logic (one answer per respondent,
 *  or several for checkboxes, first match wins). */
export const LOGIC_TYPES = ['single', 'multi', 'dropdown'];

/** Types a display condition can test with "is / is not <answer>". */
export const CONDITION_TYPES = ['single', 'multi', 'dropdown', 'rating', 'nps'];

export const THEME_PRESETS = [
  { id: 'paper', name: 'Paper', accent: '#c2410c', background: '#f6f4f1', surface: '#ffffff', text: '#1f1d1a', font: 'system' },
  { id: 'ocean', name: 'Ocean', accent: '#1d5fd1', background: '#eef3fb', surface: '#ffffff', text: '#15233b', font: 'system' },
  { id: 'forest', name: 'Forest', accent: '#2f6b3f', background: '#eef3ec', surface: '#ffffff', text: '#1a2a1e', font: 'humanist' },
  { id: 'plum', name: 'Plum', accent: '#7a3f98', background: '#f4eff7', surface: '#ffffff', text: '#2a1d33', font: 'system' },
  { id: 'sand', name: 'Sand', accent: '#8a5a1f', background: '#f5efe4', surface: '#fffdf8', text: '#2e2416', font: 'serif' },
  { id: 'slate', name: 'Slate', accent: '#334e68', background: '#e9edf1', surface: '#ffffff', text: '#1b2733', font: 'system' },
  { id: 'rose', name: 'Rose', accent: '#b4234f', background: '#fbf0f3', surface: '#ffffff', text: '#2f1820', font: 'rounded' },
  { id: 'teal', name: 'Lagoon', accent: '#0f6e74', background: '#e8f4f4', surface: '#ffffff', text: '#122a2b', font: 'system' },
  { id: 'midnight', name: 'Midnight', accent: '#8fb3ff', background: '#10141c', surface: '#181e29', text: '#e8edf6', font: 'system' },
  { id: 'graphite', name: 'Graphite', accent: '#ffb86b', background: '#151515', surface: '#1f1f1f', text: '#f1f1f1', font: 'humanist' },
  { id: 'mono', name: 'Ink', accent: '#111111', background: '#ffffff', surface: '#ffffff', text: '#111111', font: 'mono' },
  { id: 'meadow', name: 'Meadow', accent: '#4d7c0f', background: '#f3f7e9', surface: '#ffffff', text: '#1f2a10', font: 'rounded' },
];

export const FONTS = [
  { id: 'system', label: 'Sans serif' },
  { id: 'humanist', label: 'Humanist' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'serif', label: 'Serif' },
  { id: 'mono', label: 'Monospace' },
];

/** Ready-made answer scales for choice and grid questions. Standard
 *  research scales, worded in plain language. */
export const ANSWER_PRESETS = [
  { id: 'agree5', name: 'Agree / Disagree', items: ['Strongly disagree', 'Disagree', 'Neither agree nor disagree', 'Agree', 'Strongly agree'] },
  { id: 'satisfied5', name: 'Satisfied / Dissatisfied', items: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'] },
  { id: 'likely5', name: 'Likely / Unlikely', items: ['Very unlikely', 'Unlikely', 'Neither likely nor unlikely', 'Likely', 'Very likely'] },
  { id: 'important5', name: 'Importance', items: ['Not at all important', 'Slightly important', 'Moderately important', 'Very important', 'Extremely important'] },
  { id: 'frequency5', name: 'Frequency', items: ['Never', 'Rarely', 'Sometimes', 'Often', 'Always'] },
  { id: 'quality5', name: 'Quality', items: ['Very poor', 'Poor', 'Fair', 'Good', 'Excellent'] },
  { id: 'easy5', name: 'Easy / Difficult', items: ['Very difficult', 'Difficult', 'Neither easy nor difficult', 'Easy', 'Very easy'] },
  { id: 'expect3', name: 'Expectations', items: ['Below expectations', 'Met expectations', 'Exceeded expectations'] },
  { id: 'familiar4', name: 'Familiarity', items: ['Not at all familiar', 'Slightly familiar', 'Moderately familiar', 'Very familiar'] },
  { id: 'yesno', name: 'Yes / No', items: ['Yes', 'No'] },
  { id: 'yesnomaybe', name: 'Yes / No / Not sure', items: ['Yes', 'No', 'Not sure'] },
  { id: 'truefalse', name: 'True / False', items: ['True', 'False'] },
  { id: 'age', name: 'Age ranges', items: ['Under 18', '18 to 24', '25 to 34', '35 to 44', '45 to 54', '55 to 64', '65 or older'] },
  { id: 'weekdays', name: 'Days of the week', items: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] },
  { id: 'months', name: 'Months', items: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] },
];

export function defaultTheme() {
  const p = THEME_PRESETS[0];
  return {
    preset: p.id,
    accent: p.accent,
    background: p.background,
    surface: p.surface,
    text: p.text,
    font: p.font,
    radius: 'soft',
    answerStyle: 'classic',
    logo: '',
    logoAlign: 'left',
  };
}

export function defaultOptions() {
  return {
    format: 'classic',
    progressBar: 'top',
    numbering: true,
    requiredMark: true,
    pageTitles: true,
    allowBack: true,
    buttons: { prev: 'Back', next: 'Next', done: 'Submit' },
    thankYou: { title: 'Thank you', message: 'Your response has been recorded.', redirect: '' },
    disqualify: { title: 'Thanks for your time', message: 'You do not qualify for this survey.' },
    closedMessage: 'This survey is no longer accepting responses.',
  };
}

export function makeChoice(label = '') {
  return { id: partId('c'), label };
}

function makeChoices(labels) {
  return labels.map((l) => makeChoice(l));
}

/** A new question of `type` with sensible starting content. */
export function makeQuestion(type = 'single', patch = {}) {
  const q = { id: partId('q'), type, title: '', description: '', required: false };
  switch (type) {
    case 'single':
    case 'multi':
    case 'dropdown':
      q.choices = makeChoices(['', '', '']);
      q.other = { enabled: false, label: 'Other (please specify)' };
      if (type === 'multi') q.none = { enabled: false, label: 'None of the above' };
      q.randomize = false;
      if (type !== 'dropdown') q.layout = 'vertical';
      break;
    case 'ranking':
      q.choices = makeChoices(['', '', '']);
      q.randomize = false;
      break;
    case 'rating':
      q.scale = 5;
      q.shape = 'star';
      q.minLabel = '';
      q.maxLabel = '';
      break;
    case 'nps':
      q.minLabel = 'Not at all likely';
      q.maxLabel = 'Extremely likely';
      break;
    case 'matrix':
      q.rows = makeChoices(['', '']);
      q.columns = makeChoices(ANSWER_PRESETS[0].items).map((c, i) => ({ ...c, weight: i + 1 }));
      q.multi = false;
      q.randomize = false;
      break;
    case 'slider':
      q.min = 0;
      q.max = 100;
      q.step = 1;
      q.minLabel = '';
      q.maxLabel = '';
      break;
    case 'text':
      q.validation = { kind: 'none', min: '', max: '', message: '' };
      q.placeholder = '';
      break;
    case 'textarea':
      q.validation = { kind: 'none', min: '', max: '', message: '' };
      q.placeholder = '';
      break;
    case 'multitext':
      q.fields = makeChoices(['', '']);
      break;
    case 'contact':
      q.fields = Object.fromEntries(
        CONTACT_FIELDS.map(([id, label]) => [
          id,
          { enabled: ['name', 'email'].includes(id), required: false, label },
        ]),
      );
      break;
    case 'datetime':
      q.date = true;
      q.time = false;
      break;
    case 'statement':
      break;
    default:
      break;
  }
  return { ...q, ...patch };
}

export function makePage(patch = {}) {
  return { id: partId('p'), title: '', description: '', questions: [], randomize: false, logic: null, ...patch };
}

export function makeSurvey(patch = {}) {
  const now = Date.now();
  return {
    v: SCHEMA_VERSION,
    id: surveyId(),
    title: 'Untitled survey',
    description: '',
    createdAt: now,
    updatedAt: now,
    pages: [makePage()],
    theme: defaultTheme(),
    options: defaultOptions(),
    ...patch,
  };
}

/* ---- Normalization ------------------------------------------------------ */

const str = (v, cap = 5000) => (typeof v === 'string' ? v.slice(0, cap) : '');
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);
const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const SAFE_ID = /^[a-z_][a-z0-9_]{0,31}$/i;

function normId(v, prefix, seen) {
  // Ids become object keys in answers and logic: never one that names a
  // built-in property such as __proto__ or constructor.
  const ok = typeof v === 'string' && SAFE_ID.test(v) && !seen.has(v) && !(v in Object.prototype);
  let id = ok ? v : partId(prefix);
  while (seen.has(id)) id = partId(prefix);
  seen.add(id);
  return id;
}

function normChoices(list, seen, withWeight = false) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 500).map((c, i) => {
    const raw = isObj(c) ? c : { label: c };
    const out = { id: normId(raw.id, 'c', seen), label: str(raw.label, 1000) };
    if (raw.id === OTHER_ID || raw.id === NONE_ID) out.id = normId(null, 'c', seen);
    if (withWeight) out.weight = num(raw.weight, i + 1);
    return out;
  });
}

function normCond(c) {
  if (!isObj(c) || typeof c.qid !== 'string') return null;
  const op = ['is', 'isNot', 'answered', 'notAnswered'].includes(c.op) ? c.op : 'is';
  return { qid: c.qid, op, value: c.value == null ? '' : String(c.value) };
}

function normTarget(t) {
  if (!isObj(t)) return null;
  if (t.type === 'end' || t.type === 'disqualify') return { type: t.type };
  if (t.type === 'page' && typeof t.pageId === 'string') return { type: 'page', pageId: t.pageId };
  return null;
}

export function normalizeQuestion(raw, seen = new Set()) {
  if (!isObj(raw) || !TYPE_BY_ID[raw.type]) return null;
  const base = makeQuestion(raw.type);
  const q = {
    ...base,
    id: normId(raw.id, 'q', seen),
    title: str(raw.title, 5000),
    description: str(raw.description, 5000),
    required: isAnswerable(base) ? bool(raw.required) : false,
  };
  if (raw.requiredMessage) q.requiredMessage = str(raw.requiredMessage, 300);
  const display = normCond(raw.display);
  if (display) q.display = display;
  const choiceSeen = new Set();
  switch (q.type) {
    case 'single':
    case 'multi':
    case 'dropdown':
    case 'ranking':
      q.choices = normChoices(raw.choices, choiceSeen);
      q.randomize = bool(raw.randomize);
      if (q.type !== 'ranking') {
        q.other = {
          enabled: bool(raw.other && raw.other.enabled),
          label: str(raw.other && raw.other.label, 300) || base.other.label,
        };
      }
      if (q.type === 'multi') {
        q.none = {
          enabled: bool(raw.none && raw.none.enabled),
          label: str(raw.none && raw.none.label, 300) || base.none.label,
        };
        if (raw.minSelect) q.minSelect = Math.max(0, Math.round(num(raw.minSelect, 0)));
        if (raw.maxSelect) q.maxSelect = Math.max(0, Math.round(num(raw.maxSelect, 0)));
      }
      if (q.type === 'single' || q.type === 'multi') {
        q.layout = ['vertical', 'horizontal', 'columns'].includes(raw.layout) ? raw.layout : 'vertical';
      }
      if (LOGIC_TYPES.includes(q.type) && isObj(raw.logic)) {
        const logic = {};
        for (const [cid, t] of Object.entries(raw.logic)) {
          const target = normTarget(t);
          if (target) logic[cid] = target;
        }
        if (Object.keys(logic).length) q.logic = logic;
      }
      break;
    case 'rating':
      q.scale = Math.min(10, Math.max(2, Math.round(num(raw.scale, 5))));
      q.shape = ['star', 'heart', 'thumb', 'circle'].includes(raw.shape) ? raw.shape : 'star';
      q.minLabel = str(raw.minLabel, 200);
      q.maxLabel = str(raw.maxLabel, 200);
      break;
    case 'nps':
      q.minLabel = typeof raw.minLabel === 'string' ? str(raw.minLabel, 200) : base.minLabel;
      q.maxLabel = typeof raw.maxLabel === 'string' ? str(raw.maxLabel, 200) : base.maxLabel;
      break;
    case 'matrix':
      q.rows = normChoices(raw.rows, choiceSeen);
      q.columns = normChoices(raw.columns, choiceSeen, true);
      q.multi = bool(raw.multi);
      q.randomize = bool(raw.randomize);
      break;
    case 'slider':
      q.min = num(raw.min, 0);
      q.max = num(raw.max, 100);
      if (q.max <= q.min) q.max = q.min + 1;
      q.step = num(raw.step, 1) > 0 ? num(raw.step, 1) : 1;
      q.minLabel = str(raw.minLabel, 200);
      q.maxLabel = str(raw.maxLabel, 200);
      break;
    case 'text':
    case 'textarea': {
      const v = isObj(raw.validation) ? raw.validation : {};
      const kinds = q.type === 'text' ? ['none', 'email', 'number', 'integer', 'length'] : ['none', 'length'];
      q.validation = {
        kind: kinds.includes(v.kind) ? v.kind : 'none',
        min: v.min === '' || v.min == null ? '' : num(v.min, ''),
        max: v.max === '' || v.max == null ? '' : num(v.max, ''),
        message: str(v.message, 300),
      };
      q.placeholder = str(raw.placeholder, 200);
      break;
    }
    case 'multitext':
      q.fields = normChoices(raw.fields, choiceSeen);
      break;
    case 'contact': {
      const conf = isObj(raw.fields) ? raw.fields : {};
      q.fields = Object.fromEntries(
        CONTACT_FIELDS.map(([id, label]) => {
          const f = isObj(conf[id]) ? conf[id] : base.fields[id];
          return [id, { enabled: bool(f.enabled, false), required: bool(f.required), label: str(f.label, 200) || label }];
        }),
      );
      break;
    }
    case 'datetime':
      q.date = bool(raw.date, true);
      q.time = bool(raw.time, false);
      if (!q.date && !q.time) q.date = true;
      break;
    default:
      break;
  }
  return q;
}

export function normalizeTheme(raw) {
  const d = defaultTheme();
  if (!isObj(raw)) return d;
  const color = (v, fb) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fb);
  return {
    preset: str(raw.preset, 40) || 'custom',
    accent: color(raw.accent, d.accent),
    background: color(raw.background, d.background),
    surface: color(raw.surface, d.surface),
    text: color(raw.text, d.text),
    font: FONTS.some((f) => f.id === raw.font) ? raw.font : d.font,
    radius: ['sharp', 'soft', 'round'].includes(raw.radius) ? raw.radius : d.radius,
    answerStyle: ['classic', 'tiles'].includes(raw.answerStyle) ? raw.answerStyle : d.answerStyle,
    // Logos are small data: URLs (downscaled on upload, see style panel).
    logo: typeof raw.logo === 'string' && /^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(raw.logo) && raw.logo.length < 200_000 ? raw.logo : '',
    logoAlign: ['left', 'center', 'right'].includes(raw.logoAlign) ? raw.logoAlign : 'left',
  };
}

export function normalizeOptions(raw) {
  const d = defaultOptions();
  if (!isObj(raw)) return d;
  const b = isObj(raw.buttons) ? raw.buttons : {};
  const ty = isObj(raw.thankYou) ? raw.thankYou : {};
  const dq = isObj(raw.disqualify) ? raw.disqualify : {};
  const redirect = str(ty.redirect, 2000).trim();
  return {
    format: ['classic', 'focus'].includes(raw.format) ? raw.format : d.format,
    progressBar: ['top', 'bottom', 'off'].includes(raw.progressBar) ? raw.progressBar : d.progressBar,
    numbering: bool(raw.numbering, d.numbering),
    requiredMark: bool(raw.requiredMark, d.requiredMark),
    pageTitles: bool(raw.pageTitles, d.pageTitles),
    allowBack: bool(raw.allowBack, d.allowBack),
    buttons: {
      prev: str(b.prev, 40) || d.buttons.prev,
      next: str(b.next, 40) || d.buttons.next,
      done: str(b.done, 40) || d.buttons.done,
    },
    thankYou: {
      title: typeof ty.title === 'string' ? str(ty.title, 300) : d.thankYou.title,
      message: typeof ty.message === 'string' ? str(ty.message, 3000) : d.thankYou.message,
      redirect: /^https?:\/\//i.test(redirect) ? redirect : '',
    },
    disqualify: {
      title: typeof dq.title === 'string' ? str(dq.title, 300) : d.disqualify.title,
      message: typeof dq.message === 'string' ? str(dq.message, 3000) : d.disqualify.message,
    },
    closedMessage: typeof raw.closedMessage === 'string' ? str(raw.closedMessage, 1000) : d.closedMessage,
  };
}

/** Repair anything into a valid survey. Never throws. */
export function normalizeSurvey(raw) {
  const src = isObj(raw) ? raw : {};
  const qSeen = new Set();
  const pSeen = new Set();
  let pages = Array.isArray(src.pages) ? src.pages : [];
  pages = pages.slice(0, 200).map((p) => {
    const page = isObj(p) ? p : {};
    return {
      id: normId(page.id, 'p', pSeen),
      title: str(page.title, 1000),
      description: str(page.description, 5000),
      questions: (Array.isArray(page.questions) ? page.questions : [])
        .slice(0, 500)
        .map((q) => normalizeQuestion(q, qSeen))
        .filter(Boolean),
      randomize: bool(page.randomize),
      logic: normTarget(page.logic),
    };
  });
  if (!pages.length) pages = [makePage()];
  const now = Date.now();
  return {
    v: SCHEMA_VERSION,
    id: typeof src.id === 'string' && /^[a-z0-9]{6,32}$/i.test(src.id) ? src.id : surveyId(),
    title: str(src.title, 300) || 'Untitled survey',
    description: str(src.description, 5000),
    createdAt: num(src.createdAt, now),
    updatedAt: num(src.updatedAt, now),
    pages: dropDanglingLogic(pages),
    theme: normalizeTheme(src.theme),
    options: normalizeOptions(src.options),
  };
}

/** Whether a display condition can still be met by its source question. */
function conditionFits(cond, src) {
  if (!src || !isAnswerable(src)) return false;
  if (cond.op !== 'is' && cond.op !== 'isNot') return true;
  if (!CONDITION_TYPES.includes(src.type)) return false;
  const v = String(cond.value);
  if (src.type === 'rating') return /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= ratingMax(src);
  if (src.type === 'nps') return /^\d+$/.test(v) && Number(v) <= 10;
  if (v === OTHER_ID) return !!(src.other && src.other.enabled);
  if (v === NONE_ID) return !!(src.none && src.none.enabled);
  return (src.choices || []).some((c) => c.id === v);
}

/**
 * Remove logic that points at pages, questions or answers that no longer
 * exist, and display conditions that refer to a question at or after the
 * one they guard (a condition can only look back), or to an answer their
 * source can no longer give (a removed choice, a changed type or scale).
 */
export function dropDanglingLogic(pages) {
  const pageIndex = new Map(pages.map((p, i) => [p.id, i]));
  const before = new Map();
  const allQ = [];
  for (const p of pages) for (const q of p.questions) allQ.push(q);
  allQ.forEach((q, i) => before.set(q.id, i));
  const byId = new Map(allQ.map((q) => [q.id, q]));
  // Jumps only ever go forward (the runtime ignores any other), so a page
  // target must come after the page the rule is on.
  const fixTarget = (t, from) => (t && (t.type !== 'page' || pageIndex.get(t.pageId) > from) ? t : null);
  let changed = false;
  const next = pages.map((p, pi) => {
    let pageChanged = false;
    const logic = fixTarget(p.logic, pi);
    if (logic !== p.logic) pageChanged = true;
    const questions = p.questions.map((q) => {
      let nq = q;
      if (q.logic) {
        const valid = new Set((q.choices || []).map((c) => c.id));
        if (q.other && q.other.enabled) valid.add(OTHER_ID);
        if (q.none && q.none.enabled) valid.add(NONE_ID);
        const logic2 = {};
        for (const [cid, t] of Object.entries(q.logic)) {
          const ft = fixTarget(t, pi);
          if (ft && valid.has(cid)) logic2[cid] = ft;
        }
        if (Object.keys(logic2).length !== Object.keys(q.logic).length) {
          nq = { ...nq };
          if (Object.keys(logic2).length) nq.logic = logic2;
          else delete nq.logic;
        }
      }
      if (q.display) {
        const src = byId.get(q.display.qid);
        const ok = src && before.get(src.id) < before.get(q.id) && conditionFits(q.display, src);
        if (!ok) {
          nq = { ...nq };
          delete nq.display;
        }
      }
      if (nq !== q) pageChanged = true;
      return nq;
    });
    if (!pageChanged) return p;
    changed = true;
    return { ...p, logic, questions };
  });
  return changed ? next : pages;
}

/* ---- Helpers ------------------------------------------------------------ */

export function allQuestions(survey) {
  const out = [];
  for (const p of survey.pages) for (const q of p.questions) out.push(q);
  return out;
}

export function findQuestion(survey, qid) {
  for (let pi = 0; pi < survey.pages.length; pi++) {
    const qi = survey.pages[pi].questions.findIndex((q) => q.id === qid);
    if (qi >= 0) return { page: survey.pages[pi], pageIndex: pi, question: survey.pages[pi].questions[qi], index: qi };
  }
  return null;
}

export function questionCount(survey) {
  return allQuestions(survey).filter(isAnswerable).length;
}

/** Give a question (and its choices) fresh ids, for duplicating. */
export function cloneQuestion(q) {
  const copy = structuredClone(q);
  copy.id = partId('q');
  const remap = new Map();
  for (const key of ['choices', 'rows', 'columns']) {
    if (Array.isArray(copy[key])) {
      copy[key] = copy[key].map((c) => {
        const id = partId('c');
        remap.set(c.id, id);
        return { ...c, id };
      });
    }
  }
  if (Array.isArray(copy.fields)) copy.fields = copy.fields.map((f) => ({ ...f, id: partId('c') }));
  if (copy.logic) {
    const logic = {};
    for (const [cid, t] of Object.entries(copy.logic)) logic[remap.get(cid) || cid] = t;
    copy.logic = logic;
  }
  return copy;
}

/**
 * The survey as respondents receive it: blank choices, rows and fields are
 * dropped (the builder starts new questions with empty slots), and nothing
 * the respondent page does not need is sent.
 */
export function publicSnapshot(survey) {
  const clean = (list) => (list || []).filter((c) => (c.label || '').trim());
  const pages = survey.pages.map((p) => ({
    ...p,
    questions: p.questions.map((q) => {
      const out = { ...q };
      if (out.choices) out.choices = clean(out.choices);
      if (out.rows) out.rows = clean(out.rows);
      if (out.columns) out.columns = clean(out.columns);
      if (Array.isArray(out.fields)) out.fields = clean(out.fields);
      return out;
    }),
  }));
  return {
    v: survey.v,
    id: survey.id,
    title: survey.title,
    description: survey.description,
    pages: dropDanglingLogic(pages),
    theme: survey.theme,
    options: survey.options,
  };
}

/** Problems that would confuse respondents, for the builder to flag. */
export function lintQuestion(q, survey = null) {
  const issues = [];
  if (isAnswerable(q) && !q.title.trim()) issues.push('Add question text.');
  if (q.type === 'statement' && !q.title.trim() && !q.description.trim()) issues.push('Add some text.');
  if (CHOICE_TYPES.includes(q.type)) {
    const n = (q.choices || []).filter((c) => c.label.trim()).length;
    if (n < 2 && !(q.other && q.other.enabled)) issues.push('Add at least two answer choices.');
  }
  if (q.type === 'matrix') {
    if (!(q.rows || []).some((r) => r.label.trim())) issues.push('Add at least one row.');
    if ((q.columns || []).filter((c) => c.label.trim()).length < 2) issues.push('Add at least two columns.');
  }
  if (q.type === 'multitext' && !(q.fields || []).some((f) => f.label.trim())) issues.push('Add at least one box label.');
  // Settings no answer can meet: respondents would be stuck.
  const set = (v) => v !== '' && v != null && Number.isFinite(Number(v));
  if (q.type === 'multi') {
    const n = (q.choices || []).filter((c) => c.label.trim()).length + (q.other && q.other.enabled ? 1 : 0);
    const min = Number(q.minSelect) || 0;
    const max = Number(q.maxSelect) || 0;
    if (min && max && min > max) issues.push('The minimum number of choices is more than the maximum.');
    else if (min > n) issues.push(`It asks for at least ${min} choices but has ${n}.`);
  }
  if (q.type === 'text' || q.type === 'textarea') {
    const v = q.validation || {};
    if ((v.kind === 'number' || v.kind === 'integer' || v.kind === 'length') && set(v.min) && set(v.max) && Number(v.min) > Number(v.max)) {
      issues.push(v.kind === 'length' ? 'The minimum length is more than the maximum.' : 'The minimum is more than the maximum.');
    }
    const cap = q.type === 'text' ? 1000 : 10000;
    if (v.kind === 'length' && Number(v.min) > cap) issues.push(`The minimum length is more than an answer can hold (${cap} characters).`);
  }
  if (q.type === 'contact' && !fieldsOf(q).length) issues.push('Show at least one field.');
  if (q.type === 'slider' && set(q.min) && set(q.max) && Number(q.min) >= Number(q.max)) issues.push('The slider’s lowest value must be below its highest.');
  // Shown for an answer whose text was cleared: respondents never see that
  // answer, and publishing drops the condition, so the question always shows.
  const cond = q.display;
  if (survey && cond && (cond.op === 'is' || cond.op === 'isNot')) {
    const src = allQuestions(survey).find((x) => x.id === cond.qid);
    const choice = src && CHOICE_TYPES.includes(src.type) && (src.choices || []).find((c) => c.id === cond.value);
    if (choice && !choice.label.trim()) issues.push('It is shown for an answer with no text, which respondents never see. Add that answer’s text, or this question always shows.');
  }
  return issues;
}
