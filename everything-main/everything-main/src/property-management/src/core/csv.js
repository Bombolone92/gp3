/** RFC 4180 CSV parsing and writing. */

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
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
    if (ch === '"') {
      quoted = true;
      i++;
    } else if (ch === ',') {
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
  // Neutralize spreadsheet formula injection, but keep plain numbers
  // (negative amounts such as credits) as numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
  // A byte order mark tells Excel the CSV is UTF-8; without it, names like
  // "José" and the "·" in labels open garbled. Importing strips it again.
  if (type.startsWith('text/csv') && !text.startsWith('\uFEFF')) text = `\uFEFF${text}`;
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
