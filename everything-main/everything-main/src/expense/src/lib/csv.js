/**
 * CSV parsing for statement imports, plus escaping for exports.
 * Handles quoted fields, embedded newlines, CRLF, BOM, and ; / tab delimiters.
 */

import { parseAmount } from './money.js';
import { parseLooseDate, detectDayFirst } from './dates.js';
import { normalizeText } from './util.js';

export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 10).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const counts = head.split('\n').filter(Boolean).map((line) => countOutsideQuotes(line, d));
    if (!counts.length) continue;
    const min = Math.min(...counts);
    const consistent = counts.every((c) => c === counts[0]);
    const score = min * (consistent ? 2 : 1);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line, ch) {
  let n = 0;
  let inQ = false;
  for (const c of line) {
    if (c === '"') inQ = !inQ;
    else if (c === ch && !inQ) n += 1;
  }
  return n;
}

export function parseCSV(text, { delimiter } = {}) {
  let src = String(text || '');
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1);
  const d = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQ = false;
      } else field += c;
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === d) { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

const DATE_HEADERS = ['date', 'transaction date', 'posted', 'posting date', 'trans date', 'booking date', 'value date', 'datum', 'fecha'];
const DESC_HEADERS = ['description', 'memo', 'merchant', 'payee', 'name', 'details', 'narrative', 'transaction', 'reference', 'beschreibung', 'concepto'];
const AMOUNT_HEADERS = ['amount', 'value', 'transaction amount', 'sum', 'betrag', 'importe', 'total'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'money out', 'paid out', 'charge', 'outflow', 'expense'];
const CREDIT_HEADERS = ['credit', 'deposit', 'money in', 'paid in', 'inflow', 'income'];

function headerIndex(headers, names) {
  const norm = headers.map((h) => normalizeText(h));
  for (const n of names) {
    const i = norm.findIndex((h) => h === n);
    if (i !== -1) return i;
  }
  for (const n of names) {
    const i = norm.findIndex((h) => h.includes(n));
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Guess how a statement CSV is laid out. Returns
 * { hasHeader, dateCol, descCol, amountCol, debitCol, creditCol, dayFirst, negate }.
 * `negate` is true when charges appear as positive numbers (typical for card statements).
 */
export function detectStatementColumns(rows) {
  if (!rows.length) return null;
  const first = rows[0];
  const looksHeader = first.every((f) => !isNumericish(f)) && first.some((f) => /[a-z]/i.test(f));
  const headers = looksHeader ? first : first.map((_, i) => `col${i + 1}`);
  const body = looksHeader ? rows.slice(1) : rows;
  const sample = body.slice(0, 40);
  const cols = first.length;

  let dateCol = looksHeader ? headerIndex(headers, DATE_HEADERS) : -1;
  let descCol = looksHeader ? headerIndex(headers, DESC_HEADERS) : -1;
  let amountCol = looksHeader ? headerIndex(headers, AMOUNT_HEADERS) : -1;
  let debitCol = looksHeader ? headerIndex(headers, DEBIT_HEADERS) : -1;
  let creditCol = looksHeader ? headerIndex(headers, CREDIT_HEADERS) : -1;
  if (debitCol !== -1 && debitCol === amountCol) amountCol = -1;

  // Fall back to content sniffing for anything unnamed.
  const score = (i, fn) => sample.filter((r) => fn(r[i] ?? '')).length / Math.max(1, sample.length);
  if (dateCol === -1) {
    let best = 0;
    for (let i = 0; i < cols; i++) {
      const s = score(i, (v) => !!parseLooseDate(v));
      if (s > best && s >= 0.6) { best = s; dateCol = i; }
    }
  }
  if (amountCol === -1 && debitCol === -1) {
    let best = 0;
    for (let i = 0; i < cols; i++) {
      if (i === dateCol) continue;
      const s = score(i, (v) => isNumericish(v));
      if (s > best && s >= 0.6) { best = s; amountCol = i; }
    }
  }
  if (descCol === -1) {
    let best = 0;
    for (let i = 0; i < cols; i++) {
      if (i === dateCol || i === amountCol || i === debitCol || i === creditCol) continue;
      const lengths = sample.map((r) => (r[i] || '').length);
      const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
      const s = avg * score(i, (v) => /[a-z]/i.test(v));
      if (s > best) { best = s; descCol = i; }
    }
  }

  const dayFirst = dateCol === -1 ? false : detectDayFirst(sample.map((r) => r[dateCol]));
  // Card statements usually list purchases as positive numbers; bank exports as negatives.
  let negate = false;
  if (amountCol !== -1) {
    const nums = sample.map((r) => parseAmount(r[amountCol])).filter((n) => n !== null && n !== 0);
    const negatives = nums.filter((n) => n < 0).length;
    // Mostly positive numbers means charges are written positive (card exports);
    // mostly negative means the export follows the account balance (bank exports).
    negate = nums.length > 0 && negatives <= nums.length - negatives;
  }
  return { hasHeader: looksHeader, headers, dateCol, descCol, amountCol, debitCol, creditCol, dayFirst, negate };
}

function isNumericish(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  return /^[-+(]?\s*[^\d]{0,4}\s*\d[\d.,\s]*\)?-?$/.test(s) && /\d/.test(s);
}

/**
 * Turn parsed rows into statement lines using a column mapping.
 * Amounts are normalised so that a charge (money out) is positive.
 * Lines that can't produce a date and an amount are reported in `skipped`.
 */
export function rowsToStatementLines(rows, mapping, { currency = 'USD' } = {}) {
  const lines = [];
  const skipped = [];
  const body = mapping.hasHeader ? rows.slice(1) : rows;
  body.forEach((r, i) => {
    const date = parseLooseDate(r[mapping.dateCol], { dayFirst: mapping.dayFirst });
    let amount = null;
    if (mapping.amountCol !== -1 && mapping.amountCol != null) {
      const raw = parseAmount(r[mapping.amountCol]);
      if (raw !== null) amount = mapping.negate ? raw : -raw;
    } else {
      const debit = mapping.debitCol >= 0 ? parseAmount(r[mapping.debitCol]) : null;
      const credit = mapping.creditCol >= 0 ? parseAmount(r[mapping.creditCol]) : null;
      if (debit !== null && debit !== 0) amount = Math.abs(debit);
      else if (credit !== null && credit !== 0) amount = -Math.abs(credit);
      else if (debit === 0 || credit === 0) amount = 0;
    }
    const description = String(r[mapping.descCol] ?? '').trim();
    if (!date || amount === null) {
      skipped.push({ row: i + (mapping.hasHeader ? 2 : 1), reason: !date ? 'No date' : 'No amount' });
      return;
    }
    lines.push({ date, description, amount, currency });
  });
  return { lines, skipped };
}

/** Escape a CSV field and neutralise spreadsheet formula injection. */
export function csvEscape(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+@\t\r-]/.test(s) && !/^-?\d[\d.,]*$/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}
