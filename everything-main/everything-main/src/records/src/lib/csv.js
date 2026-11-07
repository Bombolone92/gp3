/**
 * CSV and TSV reading and writing (RFC 4180: quoted fields, doubled quotes,
 * line breaks inside quotes). The delimiter is detected from the first
 * lines when not given.
 */

export function detectDelimiter(text) {
  const sample = text.slice(0, 10000);
  const lines = sample.split(/\r?\n/).slice(0, 10);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => countOutsideQuotes(l, d)).filter((n) => n > 0);
    if (!counts.length) continue;
    const consistent = counts.every((c) => c === counts[0]);
    const score = counts.length * (consistent ? 10 : 1) + counts[0];
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function countOutsideQuotes(line, d) {
  let n = 0;
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/**
 * Parse delimited text into rows of strings. literalQuotes: a field whose
 * closing quote is followed by more text was not quoted (pasted cells).
 */
export function parseCSV(text, delimiter, { literalQuotes = false } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = delimiter || detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        // Text after the closing quote: the field was not quoted, it just
        // starts with a quote (spreadsheets copy "Hi" there as it is).
        const next = text[i];
        if (literalQuotes && i < n && next !== d && next !== '\r' && next !== '\n') field = `"${field}"`;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (c === d) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function quote(v, d) {
  const s = v === null || v === undefined ? '' : String(v);
  return /["\r\n]/.test(s) || s.includes(d) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, delimiter = ',') {
  return rows.map((r) => r.map((v) => quote(v, delimiter)).join(delimiter)).join('\r\n');
}

/** Clipboard text (tab separated, as spreadsheets write it). */
export function toTSV(rows) {
  const text = rows.map((r) => r.map((v) => quote(v, '\t')).join('\t')).join('\n');
  // A line break after the rows keeps an empty last row (as spreadsheets do).
  return rows.length > 1 && rows[rows.length - 1].every((v) => v === '' || v === null || v === undefined) ? `${text}\n` : text;
}

export function parseTSV(text) {
  // A single cell without tabs or newlines stays as it is.
  if (!/[\t\n]/.test(text.replace(/\n$/, ''))) return [[text.replace(/\r?\n$/, '')]];
  const body = text.replace(/\r?\n$/, '');
  const rows = parseCSV(body, '\t', { literalQuotes: true });
  // The parser reads a final line break as the end of the last row.
  if (/\r?\n$/.test(body)) rows.push(['']);
  return rows;
}
