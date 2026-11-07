/**
 * Turn pasted text (a questionnaire from a document, an email, a list) into
 * survey questions. The rules, in the order they apply:
 *
 *   - A blank line ends a question. Without blank lines, a new question
 *     starts at a line ending in "?" or at the next number in sequence.
 *   - "---", "Page: Title", "Section 2: Title", "Part II - Title" (a number,
 *     letter or Roman numeral) or a Markdown heading starts a new page.
 *   - Lines after a question that start with a bullet, letter, number,
 *     "[ ]" or "( )" are answer choices. Unmarked short lines are choices
 *     too when there are at least two of them.
 *   - Checkbox markers ("[ ]") or "select all"/"check all" in the question
 *     make checkboxes; other lists make multiple choice (a dropdown past 12).
 *   - Without choices: "scale of 0 to 10" makes a 0-10 question, "1 to N"
 *     a star rating when it is a scale ("scale of 1 to 5", "1-5 stars",
 *     "a 1 to 10 scale", "rate ... (1 to 5)"), "describe/explain/comments"
 *     a long answer, "email" an email box, anything else a short answer.
 *   - A leading "*", a trailing "*" or "(required)" marks a question
 *     required. "Note:" or "Instructions:" lines become text blocks.
 *   - Choices like "Other (please specify)" and "None of the above" become
 *     the question's built-in Other and None options.
 */
import { makeChoice, makePage, makeQuestion } from './survey.js';

const MAX_QUESTIONS = 300;
const MAX_CHOICES = 200;

// A letter or number followed by a period needs a space after it: "1.5
// hours" and "U.S. residents" are answers, not choices "5 hours" and "S.
// residents". With a parenthesis ("a)Male") it is a marker either way.
const CHOICE_RE = /^\s*(?:(\[[ xX✓]?\])\s*|(\([ xX]?\))\s*|([-*•◦▪‣⁃○●☐□]|o(?=\s))\s*|([a-zA-Z])(?:\)\s*|\.\s+)|(\d{1,3})(?:\)\s*|\.\s+))(.+?)\s*$/;
const QNUM_RE = /^\s*(?:q(?:uestion)?\s*)?(\d{1,3})\s*([.):])\s+(.+)$/i;
// "Page 2: Title", "Section. Title", "Part 1 - Title", "Section A: Title",
// "Part II - Title": a dash needs a space beside it, so words like
// "Part-time" or "Page-turner" stay text.
const PAGE_RE = /^\s*(?:(?:page|section|part)\b\s*(?:\d+|[ivxlc]+|[a-z])?\s*(?::|\.(?=\s|$)|[-–—](?=\s|$)|\s[-–—])\s*(.*)|#{1,3}\s+(.+))$/i;
const RULE_RE = /^\s*(?:-{3,}|_{3,}|={3,})\s*$/;
const NOTE_RE = /^\s*(?:note|info|instructions?)\s*:\s*(.+)$/i;
const REQUIRED_RE = /\(\s*required\s*\)|\[\s*required\s*\]/i;
const MULTI_HINT = /\b(?:select|check|choose|tick|mark)\s+(?:all|any|every)|all that apply|more than one/i;
const LONG_HINT = /\b(?:describe|explain|comments?|tell us|feedback|suggestions?|elaborate|why\b|anything else|thoughts)/i;
const OTHER_RE = /^other\b/i;
// A range is a scale only with words saying so: "children aged 1 to 5"
// is not one.
const SCALE_RES = [
  /scale\s+(?:of|from)\s+(0|1)\s*(?:to|-|–)\s*(\d{1,2})\b/i,
  /\b(0|1)\s*(?:to|-|–)\s*(\d{1,2})\s*(?:stars?|(?:-?\s*point\s+)?scale)\b/i,
  /\brat(?:e|ing)\b.{0,80}?\b(0|1)\s*(?:to|-|–)\s*(\d{1,2})\b/i,
];
/** The [low, high] scale a question's wording names, or null. */
function scaleOf(title) {
  for (const re of SCALE_RES) {
    const m = re.exec(title);
    if (m) return [Number(m[1]), Number(m[2])];
  }
  return null;
}
const NONE_RE = /^(?:none of (?:the|these)(?: above)?|none)$/i;

function cleanTitle(raw) {
  let t = raw.trim();
  let required = false;
  if (/^\*\s*/.test(t)) {
    required = true;
    t = t.replace(/^\*\s*/, '');
  }
  if (/\s*\*$/.test(t)) {
    required = true;
    t = t.replace(/\s*\*$/, '');
  }
  if (REQUIRED_RE.test(t)) {
    required = true;
    t = t.replace(REQUIRED_RE, '').replace(/\s{2,}/g, ' ').trim();
  }
  const m = QNUM_RE.exec(t);
  let num = null;
  let style = '';
  if (m) {
    num = Number(m[1]);
    style = m[2];
    t = m[3].trim();
  }
  return { title: t, required, num, style };
}

function parseChoice(line) {
  const m = CHOICE_RE.exec(line);
  if (!m) return null;
  const [, box, round, bullet, letter, number, label] = m;
  if (!label) return null;
  return {
    label,
    checkbox: !!box,
    numbered: number != null ? Number(number) : null,
    numberStyle: number != null ? line.trim().charAt(String(number).length) : '',
    kind: box ? 'box' : round ? 'round' : bullet ? 'bullet' : letter ? 'letter' : 'number',
  };
}

function inferType(block) {
  const title = block.title;
  if (block.choices.length) {
    if (block.checkbox || MULTI_HINT.test(title)) return 'multi';
    return block.choices.length > 12 ? 'dropdown' : 'single';
  }
  const scale = scaleOf(title);
  if (scale) {
    const [lo, hi] = scale;
    if (lo === 0 && hi === 10) return 'nps';
    if (lo === 1 && hi >= 2 && hi <= 10) return 'rating';
  }
  if (/\bemail\b/i.test(title) && !LONG_HINT.test(title)) return 'email';
  return LONG_HINT.test(title) ? 'textarea' : 'text';
}

function toQuestion(block) {
  if (block.note) return makeQuestion('statement', { title: block.note.slice(0, 5000) });
  const type = inferType(block);
  const base = { title: block.title.slice(0, 5000), required: block.required, description: block.description.join('\n').slice(0, 5000) };
  if (type === 'email') {
    return makeQuestion('text', { ...base, validation: { kind: 'email', min: '', max: '', message: '' } });
  }
  if (type === 'rating') {
    // From the scale phrase itself: "COVID-19" earlier in the title is not it.
    const hi = scaleOf(block.title)[1];
    return makeQuestion('rating', { ...base, scale: hi });
  }
  if (type === 'nps' || type === 'text' || type === 'textarea') return makeQuestion(type, base);

  const q = makeQuestion(type, base);
  const labels = [];
  for (const c of block.choices.slice(0, MAX_CHOICES)) {
    if (OTHER_RE.test(c) && q.other) q.other = { enabled: true, label: c };
    else if (NONE_RE.test(c) && type === 'multi') q.none = { enabled: true, label: c };
    else labels.push(c);
  }
  q.choices = labels.map((l) => makeChoice(l.slice(0, 1000)));
  return q;
}

/**
 * Parse text into pages of questions:
 *   { pages: [{ title, questions: [question] }], count }
 * Never throws; text with no questions gives no questions.
 */
export function parseQuestions(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const pages = [{ title: '', blocks: [] }];
  let block = null;
  let count = 0;

  const flush = () => {
    if (!block) return;
    // Unmarked short lines under a question are choices when there are two
    // or more; a single one is more likely a description.
    if (!block.choices.length && block.loose.length >= 2 && block.loose.every((l) => l.length <= 120 && !/[?]$/.test(l))) {
      block.choices = block.loose;
    } else {
      block.description.push(...block.loose);
    }
    if (count < MAX_QUESTIONS && (block.title || block.note)) {
      pages[pages.length - 1].blocks.push(block);
      count++;
    }
    block = null;
  };

  const start = (line) => {
    const note = NOTE_RE.exec(line);
    if (note) {
      block = { note: note[1].trim(), title: '', choices: [], loose: [], description: [], required: false };
      return;
    }
    const { title, required, num, style } = cleanTitle(line);
    block = { title, required, num, style, choices: [], loose: [], description: [], checkbox: false, choiceStyle: '' };
  };

  for (const raw of lines) {
    // Runs of spaces and tabs (pasted from PDFs and tables) mean nothing
    // here, and long runs make the patterns below slow: one space each.
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) {
      flush();
      continue;
    }
    if (RULE_RE.test(line)) {
      flush();
      pages.push({ title: '', blocks: [] });
      continue;
    }
    const pageMatch = PAGE_RE.exec(line);
    if (pageMatch && !/\?\s*$/.test(line)) {
      flush();
      const title = (pageMatch[1] || pageMatch[2] || '').trim();
      const current = pages[pages.length - 1];
      // The first heading names the first page instead of adding an empty one.
      if (!current.blocks.length && !current.title) current.title = title;
      else pages.push({ title, blocks: [] });
      continue;
    }
    if (!block) {
      start(line);
      continue;
    }
    if (block.note) {
      block.note += ` ${line}`;
      continue;
    }
    const numbered = QNUM_RE.exec(line);
    const choice = parseChoice(line);
    const endsQ = /\?\s*\**\s*(?:\(required\))?$/i.test(line);
    // A numbered line continuing the question numbering starts a new
    // question, unless the choices themselves are numbered the same way.
    const nextNumber =
      numbered &&
      block.num != null &&
      Number(numbered[1]) === block.num + 1 &&
      numbered[2] === block.style &&
      (endsQ || block.choiceStyle !== `number${block.style}`);
    // A line ending in "?" is a new question, unless it is clearly marked as
    // a choice ("a) Not sure?"). A "*" bullet ending in "?" is a required
    // question, since "*" also marks required questions.
    const asQuestion =
      endsQ &&
      (!choice || (choice.kind === 'bullet' && line.startsWith('*')) || (choice.kind === 'number' && !block.choices.length));
    if (nextNumber || asQuestion) {
      flush();
      start(line);
      continue;
    }
    if (choice) {
      block.choices.push(...block.loose, choice.label);
      block.loose = [];
      if (choice.checkbox) block.checkbox = true;
      if (choice.kind === 'number') block.choiceStyle = `number${choice.numberStyle}`;
      continue;
    }
    if (block.choices.length) block.choices.push(line);
    else block.loose.push(line);
  }
  flush();

  const out = pages
    .filter((p, i) => p.blocks.length || (i === 0 && p.title))
    .map((p) => ({ title: p.title.slice(0, 1000), questions: p.blocks.map(toQuestion) }))
    .filter((p) => p.questions.length);
  return { pages: out, count: out.reduce((n, p) => n + p.questions.length, 0) };
}

/** Parsed pages as survey pages. */
export function toSurveyPages(parsed) {
  return parsed.pages.map((p) => makePage({ title: p.title, questions: p.questions }));
}
