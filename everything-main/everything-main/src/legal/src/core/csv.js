/** RFC 4180 CSV writing and parsing. */

const FORMULA = /^[=+\-@\t\r]/;

/**
 * One cell. Text that a spreadsheet would run as a formula is prefixed with
 * an apostrophe (CSV injection), except plain negative numbers.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (FORMULA.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** rows: array of arrays. */
export function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Parse CSV text into an array of arrays of strings. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') quoted = true; // a quote only opens a field at its start (spaces after the comma allowed)
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Rows of objects keyed by the header row (lower-cased, trimmed). */
export function csvObjects(text) {
  const [head, ...body] = parseCsv(text);
  if (!head) return [];
  const keys = head.map((k) => k.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** Offer a CSV file for download in the browser. */
export function downloadCsv(filename, rows) {
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
