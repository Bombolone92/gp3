/**
 * CSV import: a real parser, a column mapping, and one row → one contract.
 *
 * Everything here is pure so the fiddly parts — quoted fields containing
 * commas and newlines, "12 months" where a number belongs, 03/04/2026 meaning
 * two different days depending on where you live — are testable without a
 * browser. Nothing is written; the caller reviews the result first.
 */

import { CONTRACT_TYPES, CONTRACT_STATUSES, BILLING_PERIODS } from './store.js';
import { isValidISO } from './dates.js';
import { normalizeCurrency } from './money.js';

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

/** Delimiters worth guessing between; spreadsheets outside the US often use ';'. */
const DELIMITERS = [',', ';', '\t', '|'];

/**
 * The delimiter that appears most often outside quoted spans in the first
 * line. Falls back to a comma, which is what "CSV" claims to mean.
 */
export function sniffDelimiter(text) {
  const line = firstLineOutsideQuotes(String(text ?? ''));
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    const count = countOutsideQuotes(line, d);
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function firstLineOutsideQuotes(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === '\n' && !quoted) return text.slice(0, i);
  }
  return text;
}

function countOutsideQuotes(line, char) {
  let quoted = false;
  let count = 0;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === char && !quoted) count += 1;
  }
  return count;
}

/**
 * Rows of fields. Handles quoted fields containing the delimiter, newlines and
 * doubled quotes, plus CRLF and a leading BOM — all of which a `split(',')`
 * gets wrong on the first real spreadsheet export.
 */
export function parseRows(text, delimiter = null) {
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  const sep = delimiter || sniffDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote is one literal quote; a single one ends the field.
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false;
        i += 1;
        continue;
      }
      // Newlines inside quotes belong to the value, normalized to \n.
      if (ch === '\r') {
        field += '\n';
        i += src[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') { quoted = true; i += 1; continue; }
    if (ch === sep) { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  row.push(field);
  rows.push(row);
  // A file normally ends with a newline; that is not an empty record.
  while (rows.length && rows[rows.length - 1].every((f) => f.trim() === '')) rows.pop();
  return rows;
}

/** { headers, rows } with blank records dropped. */
export function parseTable(text, delimiter = null) {
  const rows = parseRows(text, delimiter);
  if (!rows.length) return { headers: [], rows: [] };
  return {
    headers: rows[0].map((h) => h.trim()),
    rows: rows.slice(1).filter((r) => r.some((f) => f.trim() !== '')),
  };
}

/* ------------------------------------------------------------------ */
/* Column mapping                                                      */
/* ------------------------------------------------------------------ */

/**
 * The fields a spreadsheet can fill in. Aliases only have to be close: they
 * are compared with punctuation and case stripped, and a header that contains
 * an alias counts.
 */
export const IMPORT_FIELDS = [
  {
    key: 'title', label: 'Title', required: true,
    aliases: ['title', 'contract', 'contractname', 'name', 'agreement', 'description'],
  },
  {
    key: 'counterparty', label: 'Counterparty',
    aliases: ['counterparty', 'vendor', 'supplier', 'company', 'client', 'customer', 'party', 'contact'],
  },
  { key: 'type', label: 'Type', aliases: ['type', 'category', 'kind'] },
  { key: 'status', label: 'Status', aliases: ['status', 'state'] },
  { key: 'value', label: 'Value', aliases: ['value', 'amount', 'price', 'cost', 'fee', 'spend'] },
  { key: 'currency', label: 'Currency', aliases: ['currency', 'ccy', 'curr'] },
  {
    key: 'billing', label: 'Billing period',
    aliases: ['billing', 'billingperiod', 'frequency', 'period', 'paymentterms'],
  },
  {
    key: 'startDate', label: 'Start date',
    aliases: ['startdate', 'start', 'commencement', 'effectivedate', 'signed', 'from'],
  },
  {
    key: 'endDate', label: 'End date',
    aliases: ['enddate', 'end', 'expiry', 'expiration', 'expires', 'renewaldate', 'renewal', 'to'],
  },
  {
    key: 'autoRenew', label: 'Auto-renews',
    aliases: ['autorenew', 'autorenews', 'autorenewal', 'renews', 'evergreen'],
  },
  {
    key: 'termMonths', label: 'Renewal term (months)',
    aliases: ['termmonths', 'term', 'renewalterm', 'termlength', 'contractlength'],
  },
  {
    key: 'noticeDays', label: 'Notice period (days)',
    aliases: ['noticedays', 'notice', 'noticeperiod', 'cancellationnotice'],
  },
  { key: 'tags', label: 'Tags', aliases: ['tags', 'labels', 'tag'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'comments', 'remarks', 'detail', 'details'] },
];

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Best guess at { fieldKey: columnIndex }, exact alias matches first so a
 * "Renewal date" column doesn't get claimed by "Renewal term". Each column is
 * used at most once.
 */
export function guessMapping(headers) {
  const norm = headers.map(squash);
  const mapping = {};
  const taken = new Set();

  const claim = (key, index) => {
    if (index < 0 || taken.has(index)) return false;
    mapping[key] = index;
    taken.add(index);
    return true;
  };

  for (const field of IMPORT_FIELDS) {
    const index = norm.findIndex((h, i) => !taken.has(i) && field.aliases.includes(h));
    claim(field.key, index);
  }
  for (const field of IMPORT_FIELDS) {
    if (mapping[field.key] !== undefined) continue;
    const index = norm.findIndex((h, i) => !taken.has(i) && h
      && field.aliases.some((a) => h.includes(a)));
    claim(field.key, index);
  }
  return mapping;
}

/* ------------------------------------------------------------------ */
/* Value parsing                                                       */
/* ------------------------------------------------------------------ */

/** Whether this browser's locale writes the day or the month first. */
export function localeDateOrder() {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'numeric', year: 'numeric' })
      .formatToParts(new Date(Date.UTC(2026, 0, 31)));
    const first = parts.find((p) => p.type === 'day' || p.type === 'month');
    return first?.type === 'month' ? 'mdy' : 'dmy';
  } catch {
    return 'dmy';
  }
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A date from a spreadsheet cell, or null. ISO is taken as written; numeric
 * dates follow `order` unless one of the numbers can only be a day; month
 * names are read directly. Nothing is guessed beyond that — a wrong end date
 * quietly breaks renewal tracking, so no date is better than a bad one.
 */
export function parseImportDate(value, order = 'dmy') {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (isValidISO(raw)) return raw;

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return build(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    let [, a, b, y] = numeric.map(Number);
    let year = y < 100 ? 2000 + y : y;
    // A number above 12 can only be a day, whatever the stated order says.
    let day = order === 'mdy' ? b : a;
    let month = order === 'mdy' ? a : b;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { day = b; month = a; }
    return build(year, month, day);
  }

  const named = raw.match(/^(\d{1,2})[\s-]*([A-Za-z]{3,})[\s-]*(\d{4})$/)
    || raw.match(/^([A-Za-z]{3,})[\s-]*(\d{1,2}),?[\s-]*(\d{4})$/);
  if (named) {
    const monthName = /^[A-Za-z]/.test(named[1]) ? named[1] : named[2];
    const day = /^[A-Za-z]/.test(named[1]) ? named[2] : named[1];
    const month = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return build(Number(named[3]), month, Number(day));
  }
  return null;

  function build(y, m, d) {
    const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValidISO(candidate) ? candidate : null;
  }
}

/**
 * "$1,234.56", "1.234,56 EUR", "(500)", "12 months" → a number, or null.
 *
 * Separators are the hard part: with both present the last one is the decimal
 * point. With only one, exactly three digits after it means grouping ("1,200"
 * is twelve hundred, not one-point-two), and anything else means a decimal
 * point ("1,5", "12.50").
 */
export function parseImportNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || /-\s*\d/.test(raw);
  const digits = raw.replace(/[^\d.,]/g, '');
  if (!/\d/.test(digits)) return null;

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let normalized;
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    normalized = digits.split(grouping).join('').replace(decimal, '.');
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.';
    const at = Math.max(lastComma, lastDot);
    const after = digits.length - at - 1;
    const grouped = digits.split(sep).length > 2 || after === 3;
    normalized = grouped ? digits.split(sep).join('') : digits.replace(sep, '.');
  } else {
    normalized = digits;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const TRUE_WORDS = ['yes', 'y', 'true', 't', '1', 'auto', 'autorenew', 'evergreen', 'rolling', 'x'];
const FALSE_WORDS = ['no', 'n', 'false', 'f', '0', 'fixed', 'none'];

/** Tri-state: true, false, or null when the cell says nothing. */
export function parseImportBoolean(value) {
  const raw = squash(value);
  if (!raw) return null;
  if (TRUE_WORDS.includes(raw)) return true;
  if (FALSE_WORDS.includes(raw)) return false;
  return null;
}

/*
 * What a spreadsheet calls these, beyond the app's own labels. Squashed the
 * way headers are (lower case, punctuation gone), so "per annum", "p.a." and
 * "/mo" all land. A cell that matches nothing here is left to the caller's
 * default — but a cell that says "Yearly" or "Expired" is not nothing, and
 * used to be read as monthly and active.
 */
const BILLING_WORDS = {
  'one-time': ['onetime', 'oneoff', 'once', 'single', 'lumpsum', 'upfront'],
  monthly: ['monthly', 'month', 'permonth', 'amonth', 'eachmonth', 'mo', 'pm', 'pcm', 'mth'],
  quarterly: ['quarterly', 'quarter', 'perquarter', 'qtr', 'q'],
  annual: ['annual', 'annually', 'yearly', 'year', 'peryear', 'ayear', 'perannum', 'annum', 'pa', 'yr'],
};

const STATUS_WORDS = {
  active: ['active', 'live', 'current', 'inforce', 'ongoing', 'open', 'signed', 'running'],
  draft: ['draft', 'pending', 'proposed', 'unsigned', 'negotiating', 'innegotiation'],
  terminated: [
    'terminated', 'ended', 'expired', 'cancelled', 'canceled', 'closed', 'completed',
    'inactive', 'lapsed', 'finished', 'archived',
  ],
};

/**
 * Match a cell against a list of { value, label }, by either, or by a word
 * the sheet uses for one of them; else null. Exact matches first, so "annual"
 * inside "semi-annual" cannot claim a cell that a whole word would have.
 */
function matchOption(value, options, words = {}) {
  const raw = squash(value);
  if (!raw) return null;
  const known = Object.keys(words);
  return options.find((o) => squash(o.value) === raw || squash(o.label) === raw)?.value
    || known.find((v) => words[v].includes(raw))
    || options.find((o) => raw.includes(squash(o.value)))?.value
    // Only words long enough not to turn up inside unrelated ones: "pa" is in
    // "paid", "q" in almost anything.
    || known.find((v) => words[v].some((w) => w.length >= 4 && raw.includes(w)))
    || null;
}

/* ------------------------------------------------------------------ */
/* Row → contract                                                      */
/* ------------------------------------------------------------------ */

/**
 * One spreadsheet row as a contract draft.
 *
 * Returns { contract, counterparty, problems, extras }:
 *   contract     fields ready for normalizeContract (nothing saved yet)
 *   counterparty the counterparty name, for matching or creating a contact
 *   problems     why the row can't be imported (empty means it can)
 *   extras       columns that were not mapped, kept so nothing is lost
 */
export function rowToContract(row, mapping, headers = [], {
  dateOrder = 'dmy', currency = 'USD', noticeDefault = 30,
} = {}) {
  const cell = (key) => {
    const index = mapping[key];
    return index === undefined || index === null ? '' : String(row[index] ?? '').trim();
  };

  const problems = [];
  const title = cell('title');
  if (!title) problems.push('no title');

  const startDate = parseImportDate(cell('startDate'), dateOrder);
  const endDate = parseImportDate(cell('endDate'), dateOrder);
  if (cell('startDate') && !startDate) problems.push(`start date "${cell('startDate')}" not understood`);
  if (cell('endDate') && !endDate) problems.push(`end date "${cell('endDate')}" not understood`);
  if (startDate && endDate && endDate < startDate) problems.push('end date is before the start date');

  const value = parseImportNumber(cell('value'));
  const termMonths = parseImportNumber(cell('termMonths'));
  const noticeDays = parseImportNumber(cell('noticeDays'));
  const autoRenew = parseImportBoolean(cell('autoRenew'));

  // Columns nobody mapped go into the notes rather than being dropped.
  const used = new Set(Object.values(mapping).filter((i) => i !== null && i !== undefined));
  const extras = [];
  for (let i = 0; i < row.length; i++) {
    if (used.has(i)) continue;
    const text = String(row[i] ?? '').trim();
    if (!text) continue;
    extras.push(`${headers[i]?.trim() || `Column ${i + 1}`}: ${text}`);
  }

  const notes = [cell('notes'), ...extras].filter(Boolean).join('\n');

  return {
    problems,
    counterparty: cell('counterparty'),
    extras,
    contract: {
      title,
      type: matchOption(cell('type'), CONTRACT_TYPES) || 'other',
      status: matchOption(cell('status'), CONTRACT_STATUSES, STATUS_WORDS) || 'active',
      value: value === null ? null : Math.abs(value),
      currency: normalizeCurrency(cell('currency'), currency),
      billing: matchOption(cell('billing'), BILLING_PERIODS, BILLING_WORDS)
        || (value !== null ? 'monthly' : 'one-time'),
      startDate,
      endDate,
      // Left off unless the sheet says so: a surprise auto-renewal is worse
      // than a contract that shows as ending.
      autoRenew: autoRenew === true,
      termMonths: termMonths && termMonths >= 1 ? Math.round(termMonths) : 12,
      noticeDays: noticeDays === null ? noticeDefault : Math.max(0, Math.round(noticeDays)),
      tags: cell('tags').split(/[,;|]/).map((t) => t.trim()).filter(Boolean),
      notes,
    },
  };
}

/**
 * Turn a parsed table into contracts plus the contacts they need.
 * `existingContacts` is matched by exact (case-insensitive) name so an import
 * links to the people already in the book instead of duplicating them.
 */
export function buildImport(table, mapping, {
  existingContacts = [], dateOrder = 'dmy', currency = 'USD', noticeDefault = 30,
} = {}) {
  const byName = new Map(existingContacts.map((c) => [c.name.trim().toLowerCase(), c]));
  const contracts = [];
  const newContacts = [];
  const skipped = [];

  table.rows.forEach((row, index) => {
    const { contract, counterparty, problems } = rowToContract(row, mapping, table.headers, {
      dateOrder, currency, noticeDefault,
    });
    if (problems.length) {
      // Row 1 is the header, so the first record is row 2 in their spreadsheet.
      skipped.push({ row: index + 2, reasons: problems });
      return;
    }
    if (counterparty) {
      const key = counterparty.toLowerCase();
      let contact = byName.get(key);
      if (!contact) {
        contact = { id: null, name: counterparty };
        byName.set(key, contact);
        newContacts.push(contact);
      }
      contract.contactName = counterparty;
    }
    contracts.push(contract);
  });

  return { contracts, newContacts, skipped };
}

/** Only used for the preview: today's date is never invented into a record. */
export function previewFields(row, mapping, headers, options) {
  const { contract, counterparty, problems } = rowToContract(row, mapping, headers, options);
  const shown = [
    ['Title', contract.title],
    ['Counterparty', counterparty],
    ['Type', CONTRACT_TYPES.find((t) => t.value === contract.type)?.label],
    ['Value', contract.value === null ? '' : `${contract.currency} ${contract.value.toLocaleString()}`],
    // The period decides what the value counts for over a year, and it is
    // assumed when the sheet does not say — so it has to be visible here,
    // where "as they will be saved" is the promise.
    ['Billing', contract.value !== null || mapping.billing !== undefined
      ? BILLING_PERIODS.find((b) => b.value === contract.billing)?.label : ''],
    ['Start date', contract.startDate || ''],
    ['End date', contract.endDate || ''],
    ['Auto-renews', mapping.autoRenew !== undefined ? (contract.autoRenew ? 'Yes' : 'No') : ''],
    ['Notice', `${contract.noticeDays} days`],
    ['Tags', contract.tags.join(', ')],
  ].filter(([, v]) => v);
  return { shown, problems };
}
