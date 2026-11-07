/**
 * Bank statement import: CSV (any bank's export, with a column mapping) and
 * OFX (Open Financial Exchange, including the .qfx and .qbo files some banks
 * name their downloads). Both produce the same normalized lines:
 *
 *   { date: 'YYYY-MM-DD', amount: cents (+ money in, - money out), desc, fitid }
 */
import { parseCSV } from './csv.js';
import { parseMoney } from './money.js';
import { isISODate, pad2 } from './dates.js';

const DATE_HEADERS = ['date', 'transaction date', 'posted date', 'posting date', 'trans date', 'value date', 'booking date'];
const DESC_HEADERS = ['description', 'payee', 'name', 'memo', 'details', 'transaction description', 'narrative', 'merchant'];
const AMOUNT_HEADERS = ['amount', 'transaction amount', 'value', 'amount (usd)'];
const DEBIT_HEADERS = ['debit', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'spent', 'debit amount', 'charges'];
const CREDIT_HEADERS = ['credit', 'deposit', 'deposits', 'money in', 'paid in', 'received', 'credit amount', 'payments'];

function find(headers, names) {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const n of names) {
    const i = lower.indexOf(n);
    if (i >= 0) return i;
  }
  for (const n of names) {
    const i = lower.findIndex((h) => h.includes(n));
    if (i >= 0) return i;
  }
  return -1;
}

/** Guess the column mapping from a header row. */
export function guessMapping(headers) {
  const date = find(headers, DATE_HEADERS);
  const desc = find(headers, DESC_HEADERS);
  const amount = find(headers, AMOUNT_HEADERS);
  let debit = find(headers, DEBIT_HEADERS);
  let credit = find(headers, CREDIT_HEADERS);
  // One "Debit/Credit" indicator column matches both lists; it is not two amount columns.
  if (debit >= 0 && debit === credit) { debit = -1; credit = -1; }
  if (amount >= 0 && !(debit >= 0 && credit >= 0)) return { date, desc, amount, debit: -1, credit: -1, mode: 'single' };
  if (debit >= 0 || credit >= 0) return { date, desc, amount: -1, debit, credit, mode: 'split' };
  return { date, desc, amount, debit: -1, credit: -1, mode: 'single' };
}

/**
 * Parse a statement date. `style` disambiguates 03/04/2026: 'mdy' or 'dmy'.
 * Also handles ISO, YYYYMMDD, "Mar 4, 2026", and "4 Mar 2026".
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseStatementDate(text, style = 'mdy') {
  const s = String(text || '').trim();
  if (!s) return null;
  if (isISODate(s.slice(0, 10))) return s.slice(0, 10);
  if (/^\d{8}/.test(s)) {
    const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    return isISODate(iso) ? iso : null;
  }
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (m) {
    let [, a, b, y] = m;
    y = y.length === 2 ? `20${y}` : y;
    let month = +a; let day = +b;
    if (style === 'dmy' || month > 12) { month = +b; day = +a; }
    const iso = `${y}-${pad2(month)}-${pad2(day)}`;
    return isISODate(iso) ? iso : null;
  }
  m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
  if (m) {
    const iso = `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
    return isISODate(iso) ? iso : null;
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) {
    const iso = `${m[3]}-${pad2(MONTHS[m[1].toLowerCase()])}-${pad2(+m[2])}`;
    return isISODate(iso) ? iso : null;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s-](\d{2,4})/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const iso = `${y}-${pad2(MONTHS[m[2].toLowerCase()])}-${pad2(+m[1])}`;
    return isISODate(iso) ? iso : null;
  }
  return null;
}

/**
 * Turn CSV rows into statement lines with a mapping. `invert` flips signs for
 * banks (usually card issuers) that export charges as positive numbers.
 * Returns { lines, skipped: [{ row, reason }] }.
 */
export function linesFromCSV(rows, mapping, { hasHeader = true, dateStyle = 'mdy', invert = false } = {}) {
  const body = hasHeader ? rows.slice(1) : rows;
  const lines = [];
  const skipped = [];
  body.forEach((r, i) => {
    const date = parseStatementDate(r[mapping.date], dateStyle);
    if (!date) { skipped.push({ row: i + (hasHeader ? 2 : 1), reason: 'No readable date' }); return; }
    let amount;
    if (mapping.mode === 'split') {
      const out = mapping.debit >= 0 ? Math.abs(parseMoney(r[mapping.debit])) : 0;
      const inn = mapping.credit >= 0 ? Math.abs(parseMoney(r[mapping.credit])) : 0;
      amount = inn - out;
    } else {
      amount = parseMoney(r[mapping.amount]);
    }
    if (invert) amount = -amount;
    if (!amount) { skipped.push({ row: i + (hasHeader ? 2 : 1), reason: 'No amount' }); return; }
    const desc = (mapping.desc >= 0 ? r[mapping.desc] : '') || '';
    lines.push({ date, amount, desc: desc.replace(/\s+/g, ' ').trim(), fitid: '' });
  });
  return { lines, skipped };
}

export function parseCSVStatement(text, opts = {}) {
  const rows = parseCSV(text);
  if (!rows.length) return { rows, headers: [], mapping: null, lines: [], skipped: [] };
  const headers = rows[0];
  const looksLikeHeader = headers.some((h) => /[a-z]/i.test(h)) && !parseStatementDate(headers[0]);
  const mapping = opts.mapping || (looksLikeHeader ? guessMapping(headers) : { date: 0, desc: 1, amount: 2, debit: -1, credit: -1, mode: 'single' });
  const { lines, skipped } = linesFromCSV(rows, mapping, { ...opts, hasHeader: looksLikeHeader });
  return { rows, headers: looksLikeHeader ? headers : headers.map((_, i) => `Column ${i + 1}`), hasHeader: looksLikeHeader, mapping, lines, skipped };
}

/**
 * OFX 1.x (SGML, unclosed tags) and 2.x (XML) statement transactions.
 *
 * One file can hold several accounts' statements (a bank's "download all
 * accounts" puts checking and savings together). Each is returned in
 * `statements`, and the first is also spread on the result.
 */
export function parseOFX(text) {
  const src = String(text || '');
  const parts = src.split(/<(STMTRS|CCSTMTRS)>/i);
  const statements = [];
  if (parts.length > 1) {
    // [before, tag, body, tag, body, ...]
    for (let i = 1; i < parts.length; i += 2) statements.push(parseStatement(parts[i + 1], /^cc/i.test(parts[i])));
  } else {
    statements.push(parseStatement(src, false));
  }
  return { ...statements[0], statements };
}

function parseStatement(src, card) {
  const lines = [];
  const blocks = src.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = parseStatementDate(ofxTag(block, 'DTPOSTED').slice(0, 8));
    const amount = parseMoney(ofxTag(block, 'TRNAMT'));
    if (!date || !amount) continue;
    const name = decodeEntities(ofxTag(block, 'NAME'));
    const memo = decodeEntities(ofxTag(block, 'MEMO'));
    const desc = [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    lines.push({ date, amount, desc, fitid: ofxTag(block, 'FITID'), checkNum: ofxTag(block, 'CHECKNUM') });
  }
  const balance = src.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i);
  const acctId = src.match(/<ACCTID>([^<\r\n]*)/i);
  const acctType = card ? 'CREDITCARD' : ofxTag(src, 'ACCTTYPE').toUpperCase();
  return { lines, balance: balance ? parseMoney(balance[1]) : null, accountNumber: acctId ? acctId[1].trim() : '', accountType: acctType };
}

function ofxTag(block, name) {
  const m = block.match(new RegExp(`<${name}>([^<\\r\\n]*)`, 'i'));
  return m ? m[1].trim() : '';
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
}

export function isOFX(text) {
  return /<OFX>|OFXHEADER/i.test(String(text || '').slice(0, 2000));
}

/** A stable identity for a statement line, for skipping re-imports. */
export function lineIdentity(line) {
  if (line.fitid) return `f:${line.fitid}`;
  return `d:${line.date}|${line.amount}|${(line.desc || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

/**
 * Drop lines already imported into the account. Duplicates inside one file
 * (two identical coffees on the same day) are kept, counted against the
 * number already present.
 *
 * Lines from the same kind of file match on identity (the FITID, or the
 * date, amount and description). A statement downloaded once as CSV and
 * once as OFX matches on date and amount alone: the CSV line has no FITID,
 * and the two formats often word the description differently.
 */
export function dedupe(newLines, existingLines) {
  const exact = new Map(); // identity -> indexes of existing lines
  const loose = new Map(); // has FITID | date | amount -> indexes
  const looseKey = (l, fit) => `${fit ? 1 : 0}|${l.date}|${l.amount}`;
  const add = (map, k, i) => { const a = map.get(k); if (a) a.push(i); else map.set(k, [i]); };
  existingLines.forEach((l, i) => {
    add(exact, lineIdentity(l), i);
    add(loose, looseKey(l, !!l.fitid), i);
  });
  const used = new Set();
  const take = (map, k) => {
    const list = map.get(k);
    while (list?.length) {
      const i = list.pop();
      if (!used.has(i)) { used.add(i); return true; }
    }
    return false;
  };
  const fresh = [];
  let duplicates = 0;
  for (const l of newLines) {
    if (take(exact, lineIdentity(l)) || take(loose, looseKey(l, !l.fitid))) { duplicates++; continue; }
    fresh.push(l);
  }
  return { fresh, duplicates };
}
