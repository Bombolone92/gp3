/** RFC 4180 CSV parsing and writing. */

/**
 * The separator a file uses: comma, or the semicolon Excel writes where the
 * decimal mark is a comma (and tab), whichever the header row has most of.
 */
function delimiterOf(s) {
  const header = s.slice(0, s.search(/[\r\n]|$/)).replace(/"[^"]*"/g, '');
  let best = ',';
  for (const d of [';', '\t']) if (header.split(d).length > header.split(best).length) best = d;
  return best;
}

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  const delimiter = delimiterOf(s);
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    // A quote only opens a quoted field at its start; elsewhere (6" pipe) it
    // is just a character, so one stray quote cannot swallow the rest of the file.
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Neutralize spreadsheet formula injection. A plain number ("-50.00")
  // cannot be a formula and must stay a number.
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Undo the formula guard toCSV adds, for values read back from our own exports. */
export function unguard(value) {
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Find the column index whose header matches any alias. */
export function findColumn(headers, aliases) {
  const norm = headers.map((h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const a of aliases) {
    const idx = norm.indexOf(a.replace(/[^a-z0-9]/g, ''));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  // Excel reads a CSV without a byte order mark in the system code page,
  // turning "José" into "JosÃ©".
  const blob = new Blob([type.startsWith('text/csv') ? `\uFEFF${text}` : text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
