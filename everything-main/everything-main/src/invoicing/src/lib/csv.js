/**
 * Reading someone else's CSV.
 *
 * Nobody's first invoice is their first invoice: people arrive from Wave,
 * FreshBooks, or an accountant's spreadsheet with forty clients and a handful
 * of unpaid invoices. This is the half of that job that has nothing to do
 * with invoicing — turning a file into rows — kept pure and tested, because
 * every real export breaks a different rule: quoted fields with commas and
 * newlines inside them, a UTF-8 BOM, CRLF endings, and semicolons instead of
 * commas wherever the decimal separator is a comma.
 */

/** The separators a real export uses, in the order they are guessed. */
const DELIMITERS = [',', ';', '\t'];

/**
 * Which separator this file uses: the one that splits the header row into
 * the most fields, comma first on a tie. Counted outside quotes, so a single
 * quoted "Doe, Jane" cannot vote for the comma.
 */
export function guessDelimiter(text) {
  const firstLine = (() => {
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"') quoted = !quoted;
      else if (!quoted && (ch === '\n' || ch === '\r')) return text.slice(0, i);
    }
    return text;
  })();
  let best = ',';
  let bestCount = 0;
  for (const d of DELIMITERS) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (!quoted && ch === d) count++;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/**
 * parseCsv(text) -> { delimiter, header: [...], rows: [[...], ...] }
 *
 * RFC 4180 with the usual real-world slack: a BOM is dropped, CRLF and CR
 * both end a record, `""` inside a quoted field is one quote, and a short
 * row is padded rather than rejected — a missing trailing field is the most
 * common export bug there is, and the mapping step reports it per column
 * with far more context than a parser could.
 */
export function parseCsv(text, { delimiter = null } = {}) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const sep = delimiter || guessDelimiter(src);
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  let started = false;   // has this record any content at all?

  const endField = () => {
    record.push(field);
    field = '';
  };
  const endRecord = () => {
    endField();
    // A line with nothing on it is not a record; a line of empty commas is.
    if (started || record.length > 1) records.push(record);
    record = [];
    started = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    // A quote only opens a quoted field at the field's start (spaces aside);
    // inside an unquoted field it is a literal character — a line reading
    // 27" monitor must not swallow every row after it into one cell.
    if (ch === '"' && field.trim() === '') { quoted = true; started = true; continue; }
    if (ch === sep) { started = true; endField(); continue; }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i++;
      endRecord();
      continue;
    }
    if (ch === '\n') { endRecord(); continue; }
    if (ch !== ' ' && ch !== '\t') started = true;
    field += ch;
  }
  if (field !== '' || record.length || quoted) endRecord();

  const header = (records.shift() || []).map((h) => String(h).trim());
  const width = header.length;
  const rows = records.map((r) => {
    const padded = r.slice(0, width);
    while (padded.length < width) padded.push('');
    return padded.map((v) => String(v).trim());
  });
  return { delimiter: sep, header, rows };
}

/**
 * A header that can be mapped: no blanks, no duplicates. Returned as a
 * message rather than thrown, like validateBackup, so the wizard can say
 * what is wrong with the file before anything is written.
 */
export function headerProblem(header) {
  if (!header.length || header.every((h) => !h)) return 'That file has no header row';
  const blanks = header.filter((h) => !h).length;
  if (blanks) return `That file’s header row has ${blanks} empty column name${blanks === 1 ? '' : 's'}`;
  const seen = new Set();
  for (const h of header) {
    const key = h.toLowerCase();
    if (seen.has(key)) return `That file has two columns named “${h}”`;
    seen.add(key);
  }
  return '';
}
