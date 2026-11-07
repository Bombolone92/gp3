/**
 * Drafting a survey with AI (puter.ai.chat). The model is asked for strict
 * JSON in a small schema of our own, and the reply is treated as untrusted:
 * extracted tolerantly (code fences, chatter around it, trailing commas),
 * mapped type by type onto our own question factories, capped in size, and
 * given fresh ids. Nothing from the model reaches the survey unvalidated.
 */
import { makeChoice, makePage, makeQuestion, makeSurvey, normalizeSurvey } from './survey.js';

export const AI_LIMITS = { pages: 8, questions: 40, choices: 25, rows: 15 };

const AI_TYPES = ['single', 'multi', 'dropdown', 'rating', 'nps', 'matrix', 'slider', 'ranking', 'text', 'textarea', 'email', 'date', 'statement'];

const SCHEMA = `{
  "title": "short survey title",
  "description": "one or two friendly sentences shown at the top",
  "thankYou": "short closing message",
  "pages": [
    {
      "title": "page title, or empty",
      "questions": [
        {
          "type": "one of: ${AI_TYPES.join(', ')}",
          "title": "the question",
          "description": "optional help text",
          "required": true,
          "choices": ["for single, multi, dropdown, ranking"],
          "other": false,
          "rows": ["for matrix: the items being rated"],
          "columns": ["for matrix: the scale, low to high"],
          "scale": 5,
          "minLabel": "for rating, nps, slider: low end label",
          "maxLabel": "for rating, nps, slider: high end label",
          "min": 0,
          "max": 100
        }
      ]
    }
  ]
}`;

/** The chat messages for a survey request. */
export function buildMessages(prompt, { questions = 0, audience = '', tone = '' } = {}) {
  const system = [
    'You design clear, unbiased, professional surveys.',
    'Reply with ONE JSON object and nothing else: no code fences, no comments, no prose.',
    `The JSON must follow this shape:\n${SCHEMA}`,
    'Rules:',
    '- Use plain, neutral wording. Avoid leading or double-barreled questions.',
    '- Use "single" for one answer, "multi" when several answers apply, "nps" for 0 to 10 likelihood to recommend, "rating" for 1 to N stars (scale 3 to 10), "matrix" to rate several items on one scale, "textarea" for open feedback, "text" for short answers, "email" for an email address, "date" for a date, "statement" for instructions with no answer.',
    '- Give choice questions 2 to 8 mutually exclusive choices. Set "other": true when a list cannot cover every answer.',
    '- Group related questions into pages with short titles. Put demographic questions last.',
    '- Mark only essential questions as required.',
    '- Never use em dashes.',
  ].join('\n');
  const want = [];
  if (questions > 0) want.push(`Aim for about ${Math.round(questions)} questions.`);
  else want.push('Use as many questions as the goal needs, usually 6 to 12.');
  if (audience) want.push(`The respondents are: ${audience}.`);
  if (tone) want.push(`Tone: ${tone}.`);
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Create a survey for this goal:\n${String(prompt).slice(0, 4000)}\n\n${want.join(' ')}` },
  ];
}

/** The reply's text, whatever shape the response came in. */
export function replyText(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  const content = resp.message ? resp.message.content : resp.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part && typeof part.text === 'string' ? part.text : '')).join('');
  }
  if (typeof resp.text === 'string') return resp.text;
  const s = typeof resp.toString === 'function' ? resp.toString() : '';
  return s === '[object Object]' ? '' : s;
}

/** The balanced {...} starting at `start` in `text`, respecting strings. */
function objectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Remove commas before } or ], outside strings. */
function dropTrailingCommas(json) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    if (ch === ',') {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j++;
      if (json[j] === '}' || json[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function parseObject(candidate) {
  for (const text of [candidate, dropTrailingCommas(candidate)]) {
    try {
      const v = JSON.parse(text);
      if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    } catch {
      /* try the next form */
    }
  }
  return null;
}

/**
 * Parse the JSON object out of a model reply. Throws when there is none.
 * Braces can come before the survey ("in {JSON} form:", a reasoning
 * block), so each opening brace is tried in turn, and an object that looks
 * like a survey wins over any other.
 */
/** The survey in a parsed reply: the object itself, or one wrapped in a
 *  few levels of others ({"survey": {...}}, {"data": {"survey": ...}}). */
function surveyIn(v, depth = 3) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  if (v.pages || v.questions) return v;
  if (!depth) return null;
  for (const x of Object.values(v)) {
    const found = surveyIn(x, depth - 1);
    if (found) return found;
  }
  return null;
}

export function extractJson(text) {
  const cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '');
  let found = false;
  let first = null;
  for (let start = cleaned.indexOf('{'), tries = 0; start >= 0 && tries < 50; start = cleaned.indexOf('{', start + 1), tries++) {
    const candidate = objectAt(cleaned, start);
    // Never closed: the reply was cut off. What is inside is only part of it.
    if (!candidate) break;
    found = true;
    const v = parseObject(candidate);
    // Objects inside this one are parts of it, not other candidates.
    start += candidate.length - 1;
    if (!v) continue;
    const survey = surveyIn(v);
    if (survey) return survey;
    first ||= v;
  }
  if (first) return first;
  throw new Error(found ? 'The reply was not valid JSON.' : 'The reply did not contain a survey.');
}

const str = (v, cap) => (typeof v === 'string' ? v.trim().slice(0, cap) : typeof v === 'number' ? String(v) : '');
const strList = (v, cap) =>
  (Array.isArray(v) ? v : [])
    .map((x) => str(typeof x === 'object' && x ? x.label || x.text || x.title : x, 300))
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, cap);

function mapQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let type = str(raw.type, 20).toLowerCase();
  const aliases = { checkbox: 'multi', checkboxes: 'multi', radio: 'single', choice: 'single', multiple_choice: 'single', stars: 'rating', long: 'textarea', paragraph: 'textarea', comment: 'textarea', short: 'text', datetime: 'date', info: 'statement', grid: 'matrix', likert: 'matrix' };
  type = aliases[type] || type;
  if (!AI_TYPES.includes(type)) return null;
  const title = str(raw.title || raw.question || raw.text, 1000);
  const description = str(raw.description, 1000);
  const required = raw.required === true;
  const minLabel = str(raw.minLabel, 100);
  const maxLabel = str(raw.maxLabel, 100);
  if (!title && type !== 'statement') return null;

  switch (type) {
    case 'single':
    case 'multi':
    case 'dropdown':
    case 'ranking': {
      const choices = strList(raw.choices || raw.options, AI_LIMITS.choices);
      if (choices.length < 2) return makeQuestion('text', { title, description, required });
      const q = makeQuestion(type, { title, description, required, choices: choices.map((c) => makeChoice(c)) });
      if (raw.other === true && q.other) q.other = { ...q.other, enabled: true };
      return q;
    }
    case 'matrix': {
      const rows = strList(raw.rows, AI_LIMITS.rows);
      const columns = strList(raw.columns, 10);
      if (!rows.length || columns.length < 2) return null;
      return makeQuestion('matrix', {
        title,
        description,
        required,
        rows: rows.map((r) => makeChoice(r)),
        columns: columns.map((c, i) => ({ ...makeChoice(c), weight: i + 1 })),
      });
    }
    case 'rating': {
      const scale = Math.min(10, Math.max(3, Math.round(Number(raw.scale) || 5)));
      return makeQuestion('rating', { title, description, required, scale, minLabel, maxLabel });
    }
    case 'nps': {
      const q = makeQuestion('nps', { title, description, required });
      if (minLabel) q.minLabel = minLabel;
      if (maxLabel) q.maxLabel = maxLabel;
      return q;
    }
    case 'slider': {
      let min = Number.isFinite(Number(raw.min)) ? Number(raw.min) : 0;
      let max = Number.isFinite(Number(raw.max)) ? Number(raw.max) : 100;
      if (max <= min) [min, max] = [0, 100];
      return makeQuestion('slider', { title, description, required, min, max, minLabel, maxLabel });
    }
    case 'email':
      return makeQuestion('text', { title, description, required, validation: { kind: 'email', min: '', max: '', message: '' } });
    case 'date':
      return makeQuestion('datetime', { title, description, required });
    case 'statement':
      return makeQuestion('statement', { title: title || description, description: title ? description : '' });
    default:
      return makeQuestion(type, { title, description, required });
  }
}

/** A survey from the parsed reply. Throws when nothing usable came back. */
export function surveyFromAi(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('The reply did not contain a survey.');
  let rawPages = Array.isArray(obj.pages) ? obj.pages : [];
  // Some models skip pages and return questions at the top level.
  if (!rawPages.length && Array.isArray(obj.questions)) rawPages = [{ title: '', questions: obj.questions }];
  let budget = AI_LIMITS.questions;
  const pages = [];
  for (const p of rawPages.slice(0, AI_LIMITS.pages)) {
    if (!p || typeof p !== 'object') continue;
    const questions = [];
    for (const raw of Array.isArray(p.questions) ? p.questions : []) {
      if (budget <= 0) break;
      const q = mapQuestion(raw);
      if (q) {
        questions.push(q);
        budget--;
      }
    }
    if (questions.length) pages.push(makePage({ title: str(p.title, 200), questions }));
  }
  if (!pages.length) throw new Error('The reply did not contain any usable questions.');
  const base = makeSurvey();
  const thanks = str(obj.thankYou, 500);
  return normalizeSurvey({
    ...base,
    title: str(obj.title, 200) || 'Untitled survey',
    description: str(obj.description, 1000),
    pages,
    options: thanks ? { ...base.options, thankYou: { ...base.options.thankYou, message: thanks } } : base.options,
  });
}

/** Ask the model for a survey. `ai` is puter.ai. */
export async function generateSurvey(ai, prompt, opts = {}, { signal } = {}) {
  if (!ai || typeof ai.chat !== 'function') throw new Error('AI is not available.');
  // The documented form for a messages array is chat(messages, testMode, options).
  const resp = await ai.chat(buildMessages(prompt, opts), false, { normalize: true, signal });
  const text = replyText(resp);
  if (!text.trim()) throw new Error('The AI returned an empty reply.');
  return surveyFromAi(extractJson(text));
}
