/**
 * A compact way to write survey templates. Templates are definitions, not
 * surveys: buildTemplate() turns one into a fresh survey every time it is
 * used, so two surveys made from the same template never share ids.
 *
 * Questions can carry a `key` so later questions refer to them by name:
 *
 *   single('Did you find what you needed?', ['Yes', 'No'], { key: 'found' }),
 *   long('What were you looking for?', { showIf: ['found', 'is', 'No'] }),
 *
 * `showIf` values are answer labels for choice questions and numbers (as
 * text) for rating and 0-10 questions. `skip` maps an answer label to
 * 'end', 'disqualify' or a page key, and pages accept `next` the same way.
 * buildTemplate() resolves all of these to real ids.
 */
import { ANSWER_PRESETS, THEME_PRESETS, cloneQuestion, makeChoice, makePage, makeQuestion, makeSurvey, normalizeSurvey, defaultOptions } from '../survey.js';

const PRESETS = Object.fromEntries(ANSWER_PRESETS.map((p) => [p.id, p.items]));

/** A preset id ('agree5') or a list of labels, as labels. */
function labels(list) {
  if (typeof list === 'string') {
    if (!PRESETS[list]) throw new Error(`Unknown answer preset: ${list}`);
    return PRESETS[list];
  }
  return list;
}

const choices = (list) => labels(list).map((l) => makeChoice(l));

function question(type, title, opts = {}, patch = {}) {
  const { key, showIf, skip, ...rest } = opts;
  const q = makeQuestion(type, { title, ...patch, ...rest });
  return { q, key, showIf, skip };
}

export const single = (title, list, opts = {}) => question('single', title, opts, { choices: choices(list) });
export const multi = (title, list, opts = {}) => question('multi', title, opts, { choices: choices(list) });
export const dropdown = (title, list, opts = {}) => question('dropdown', title, opts, { choices: choices(list) });
export const ranking = (title, list, opts = {}) => question('ranking', title, opts, { choices: choices(list) });
export const rating = (title, opts = {}) => question('rating', title, opts);
export const nps = (title, opts = {}) => question('nps', title, opts);
export const slider = (title, opts = {}) => question('slider', title, opts);
export const text = (title, opts = {}) => question('text', title, opts);
export const long = (title, opts = {}) => question('textarea', title, opts);
export const date = (title, opts = {}) => question('datetime', title, opts);
export const note = (title, description = '', opts = {}) => question('statement', title, opts, { description });

export function matrix(title, rows, columns, opts = {}) {
  return question('matrix', title, opts, {
    rows: choices(rows),
    columns: labels(columns).map((l, i) => ({ ...makeChoice(l), weight: i + 1 })),
  });
}

export function boxes(title, fieldLabels, opts = {}) {
  return question('multitext', title, opts, { fields: fieldLabels.map((l) => makeChoice(l)) });
}

/** Contact details with only `enabled` fields on; `required` lists fields
 *  that must be filled. */
export function contact(title, enabled, opts = {}) {
  const { required = [], ...rest } = opts;
  const base = makeQuestion('contact');
  const fields = {};
  for (const [id, f] of Object.entries(base.fields)) {
    fields[id] = { ...f, enabled: enabled.includes(id), required: required.includes(id) };
  }
  return question('contact', title, rest, { fields });
}

export function page(title, questions, opts = {}) {
  const { key, next, description = '' } = opts;
  return { title, description, questions, key, next };
}

/** Rough minutes to complete, from question types. */
export function estimateMinutes(survey) {
  let seconds = 0;
  for (const p of survey.pages) {
    for (const q of p.questions) {
      if (q.type === 'statement') seconds += 5;
      else if (q.type === 'textarea') seconds += 45;
      else if (q.type === 'text' || q.type === 'multitext' || q.type === 'contact') seconds += 20;
      else if (q.type === 'matrix') seconds += 8 + 6 * (q.rows || []).length;
      else if (q.type === 'ranking') seconds += 20;
      else seconds += 10;
    }
  }
  return Math.max(1, Math.round(seconds / 60));
}

function resolveTarget(target, pageIds) {
  if (target === 'end' || target === 'disqualify') return { type: target };
  if (pageIds.has(target)) return { type: 'page', pageId: pageIds.get(target) };
  throw new Error(`Unknown skip target: ${target}`);
}

function choiceIdByLabel(q, label) {
  const c = (q.choices || []).find((x) => x.label === label);
  if (!c) throw new Error(`Question "${q.title}" has no answer "${label}"`);
  return c.id;
}

/** Turn a template definition into a new survey document. */
export function buildTemplate(def) {
  const pageIds = new Map();
  const pages = def.pages.map((p) => {
    const made = makePage({ title: p.title, description: p.description });
    if (p.key) pageIds.set(p.key, made.id);
    return { def: p, made };
  });
  // Definitions are built once at load time, so every use clones its
  // questions: two surveys from one template must never share ids.
  const fresh = new Map();
  const byKey = new Map();
  for (const { def: p } of pages) {
    for (const item of p.questions) {
      const q = cloneQuestion(item.q);
      fresh.set(item, q);
      if (item.key) byKey.set(item.key, q);
    }
  }

  const outPages = pages.map(({ def: p, made }) => {
    const questions = p.questions.map((item) => {
      const q = fresh.get(item);
      if (item.showIf) {
        const [key, op, value] = item.showIf;
        const src = byKey.get(key);
        if (!src) throw new Error(`Unknown question key: ${key}`);
        const v = value == null ? '' : ['single', 'multi', 'dropdown'].includes(src.type) ? choiceIdByLabel(src, value) : String(value);
        q.display = { qid: src.id, op, value: v };
      }
      if (item.skip) {
        q.logic = {};
        for (const [label, target] of Object.entries(item.skip)) q.logic[choiceIdByLabel(q, label)] = resolveTarget(target, pageIds);
      }
      return q;
    });
    return { ...made, questions, logic: p.next ? resolveTarget(p.next, pageIds) : null };
  });

  const preset = THEME_PRESETS.find((t) => t.id === def.theme) || THEME_PRESETS[0];
  const base = makeSurvey();
  const options = { ...defaultOptions(), ...(def.options || {}) };
  if (def.thankYou) options.thankYou = { ...options.thankYou, ...def.thankYou };
  return normalizeSurvey({
    ...base,
    title: def.name,
    description: def.intro || '',
    pages: outPages,
    theme: { ...base.theme, preset: preset.id, accent: preset.accent, background: preset.background, surface: preset.surface, text: preset.text, font: preset.font },
    options,
  });
}
