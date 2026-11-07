/**
 * Quick-add parsing: a small, fixed, documented token set — never general
 * natural language. What the chips show is exactly what gets saved.
 *
 *   dates      today · tomorrow · fri · next week · +3d · +2w · aug 12 ·
 *              12 aug · 2026-08-12          (only at the very end of the text)
 *   priority   !urgent !high !medium !low, !u !h !m !l, !1 … !4
 *   label      #design                      (an existing label, or an offer
 *                                            to create one)
 *   assignee   @maya                        (an existing project member only)
 *
 * Sigil tokens are recognized wherever they appear as a whole word: `!`, `#`
 * and `@` are explicit markers, so a title that starts with one still parses.
 * Bare dates are ordinary English, so they only count as a trailing run —
 * "Plan the tomorrow party" keeps its word, "Call mum tomorrow" does not.
 *
 * Nothing here touches the store: it returns a description of the parse, and
 * the caller decides what to do with it.
 */

import { todayISO, addDays, addMonths, parseISO, isValidISO } from './dates.js';

const PRIORITY_TOKENS = new Map([
  ['urgent', 'urgent'], ['u', 'urgent'], ['1', 'urgent'],
  ['high', 'high'], ['h', 'high'], ['2', 'high'],
  ['medium', 'medium'], ['med', 'medium'], ['m', 'medium'], ['3', 'medium'],
  ['low', 'low'], ['l', 'low'], ['4', 'low'],
]);

const MONTHS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const WEEKDAYS = new Map([
  ['sun', 0], ['sunday', 0],
  ['mon', 1], ['monday', 1],
  ['tue', 2], ['tues', 2], ['tuesday', 2],
  ['wed', 3], ['weds', 3], ['wednesday', 3],
  ['thu', 4], ['thur', 4], ['thurs', 4], ['thursday', 4],
  ['fri', 5], ['friday', 5],
  ['sat', 6], ['saturday', 6],
]);

/** Rows for the "what can I type here" hint. */
export const QUICK_ADD_HINTS = [
  { token: 'tomorrow', means: 'due date' },
  { token: 'fri', means: 'the coming Friday' },
  { token: 'aug 12', means: 'a date' },
  { token: '+3d', means: 'in three days' },
  { token: '!high', means: 'priority' },
  { token: '#label', means: 'a label' },
  { token: '@name', means: 'an assignee' },
];

const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s_-]+/g, ' ').trim();
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

const MONTH_RE = MONTHS.join('|');

/** The coming <weekday>, counting today as "coming" when it matches. */
function nextWeekday(today, dow) {
  const delta = (dow - parseISO(today).getDay() + 7) % 7;
  return addDays(today, delta);
}

/**
 * A month-and-day with no year means the next one: typing "jan 5" in
 * December is planning, not backdating.
 */
function monthDay(monthIndex, day, year, today) {
  if (day < 1 || day > 31) return null;
  const guess = `${year ?? parseISO(today).getFullYear()}-`
    + `${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!isValidISO(guess)) return null;
  if (!year && guess < today) {
    const rolled = `${parseISO(guess).getFullYear() + 1}${guess.slice(4)}`;
    return isValidISO(rolled) ? rolled : null;
  }
  return guess;
}

/** Patterns tried against the end of the text, most specific first. */
const DATE_PATTERNS = [
  {
    re: /(\d{4}-\d{2}-\d{2})$/i,
    to: ([, iso]) => (isValidISO(iso) ? iso : null),
  },
  {
    re: new RegExp(`(${MONTH_RE})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?$`, 'i'),
    to: ([, mon, day, year], today) =>
      monthDay(MONTHS.indexOf(mon.toLowerCase()), Number(day), year && Number(year), today),
  },
  {
    re: new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_RE})[a-z]*\\.?(?:,?\\s*(\\d{4}))?$`, 'i'),
    to: ([, day, mon, year], today) =>
      monthDay(MONTHS.indexOf(mon.toLowerCase()), Number(day), year && Number(year), today),
  },
  {
    re: /\+(\d{1,3})\s*(d|day|days|w|week|weeks|m|month|months)$/i,
    to: ([, n, unit], today) => {
      const amount = Number(n);
      if (!amount) return today;
      if (/^d/i.test(unit)) return addDays(today, amount);
      if (/^w/i.test(unit)) return addDays(today, amount * 7);
      return addMonths(today, amount);
    },
  },
  { re: /next\s+week$/i, to: (m, today) => addDays(today, 7) },
  { re: /next\s+month$/i, to: (m, today) => addMonths(today, 1) },
  /* Only spellings that are not also ordinary words: "tom" and "tod" were
     here as shorthand, and they turned "Call Tom" into "Call" due tomorrow —
     a name silently eaten out of the title. The typing shortcuts that survive
     are the ones nobody writes by accident. */
  { re: /today$/i, to: (m, today) => today },
  { re: /(tomorrow|tmrw|tmr)$/i, to: (m, today) => addDays(today, 1) },
  {
    re: new RegExp(`(${[...WEEKDAYS.keys()].join('|')})$`, 'i'),
    to: ([, word], today) => nextWeekday(today, WEEKDAYS.get(word.toLowerCase())),
  },
];

/**
 * Pull out `!priority`, `#label` and `@assignee`. An unresolvable token —
 * `@nobody`, `!nonsense` — is left in the title rather than swallowed.
 */
function extractSigils(text, { labels, members, ignore }) {
  const tokens = [];
  const stripped = text.replace(/(^|\s)([!#@])([^\s]+)/g, (match, lead, sigil, word) => {
    const raw = `${sigil}${word}`;
    if (ignore.has(raw.toLowerCase())) return match;

    if (sigil === '!') {
      const value = PRIORITY_TOKENS.get(word.toLowerCase());
      if (!value) return match;
      tokens.push({ kind: 'priority', raw, value, label: `${value} priority` });
      return lead;
    }

    if (sigil === '#') {
      const found = labels.find((l) => norm(l.name) === norm(word));
      if (found) tokens.push({ kind: 'label', raw, value: found.id, label: found.name, color: found.color });
      else tokens.push({ kind: 'new-label', raw, value: norm(word), label: `New label “${norm(word)}”` });
      return lead;
    }

    const member = members.find((m) => norm(m.name) === norm(word)
      || norm(m.name).split(' ')[0] === norm(word));
    if (!member) return match;
    tokens.push({ kind: 'assignee', raw, value: member.id, label: member.name, member });
    return lead;
  });
  return { text: stripped, tokens };
}

/** Pull a date off the end, if the tail is one of the documented shapes. */
function extractTrailingDate(text, today, ignore) {
  const trimmed = text.replace(/\s+$/, '');
  for (const { re, to } of DATE_PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    // A date must be its own word, not the tail of a longer one.
    const at = trimmed.length - m[0].length;
    if (at > 0 && !/\s/.test(trimmed[at - 1])) continue;
    const raw = m[0];
    if (ignore.has(raw.toLowerCase())) continue;
    const iso = to(m, today);
    if (!iso) continue;
    return {
      text: trimmed.slice(0, at),
      token: { kind: 'due', raw, value: iso, label: iso },
    };
  }
  return { text: trimmed, token: null };
}

/**
 * parseQuickAdd('Ship the beta !high #design tomorrow', ctx) →
 *   { title: 'Ship the beta', dueDate, priority, labelIds, newLabels,
 *     assigneeIds, tokens }
 *
 * `ignore` holds the raw text of tokens the user asked to keep as text.
 * When every word is a token the input is taken as a plain title instead:
 * "#design" on its own is a task called "#design", not a nameless one.
 */
export function parseQuickAdd(text, {
  labels = [], members = [], today = todayISO(), ignore = new Set(),
} = {}) {
  const source = String(text ?? '');
  const lowered = new Set([...ignore].map((s) => String(s).toLowerCase()));

  const sigils = extractSigils(source, { labels, members, ignore: lowered });
  const dated = extractTrailingDate(sigils.text, today, lowered);
  const title = collapse(dated.text);
  const tokens = [...sigils.tokens, ...(dated.token ? [dated.token] : [])];

  if (!title) {
    return {
      title: collapse(source), dueDate: null, priority: null,
      labelIds: [], newLabels: [], assigneeIds: [], tokens: [],
    };
  }

  const last = (kind) => [...tokens].reverse().find((t) => t.kind === kind);
  return {
    title,
    // Two of the same facet: the last one wins, like a repeated flag.
    dueDate: last('due')?.value ?? null,
    priority: last('priority')?.value ?? null,
    labelIds: [...new Set(tokens.filter((t) => t.kind === 'label').map((t) => t.value))],
    newLabels: [...new Set(tokens.filter((t) => t.kind === 'new-label').map((t) => t.value))],
    assigneeIds: [...new Set(tokens.filter((t) => t.kind === 'assignee').map((t) => t.value))],
    tokens,
  };
}
