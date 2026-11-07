/** RFC 4180 CSV: parse (quotes, escaped quotes, CRLF, embedded newlines) and write. */

export function parseCSV(text, delimiter) {
  const src = String(text || '').replace(/^﻿/, '');
  const delim = delimiter || detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    // A quote after only spaces (`a, "b, c"`) still opens a quoted field.
    if (ch === '"' && field.trim() === '') { field = ''; quoted = true; }
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

function detectDelimiter(src) {
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const counts = [',', ';', '\t', '|'].map((d) => [d, firstLine.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Leading = + - @ would run as a formula in a spreadsheet; neutralize it.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
