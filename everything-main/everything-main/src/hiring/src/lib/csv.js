/** Minimal, correct CSV: RFC 4180 quoting, CRLF/LF, newlines in fields. */

/**
 * Parse into [{ cells, line }], where `line` is the 1-based source line
 * the row starts on. Fully empty rows are dropped — which, with header
 * rows, is exactly why callers reporting problems back to the user need
 * the source line rather than the surviving row's index.
 */
export function parseCSVWithLines(text) {
  const src = String(text ?? '');
  const rows = [];
  let row = [];
  let field = [];
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field.push('"');
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n' || (ch === '\r' && src[i + 1] !== '\n')) line++;
        field.push(ch);
      }
    } else if (ch === '"' && field.length === 0) {
      // A quote only opens a quoted field at the field's start; inside an
      // unquoted field it is a literal character (RFC 4180 §2.5 — 5" x 3"
      // must not lose its inch marks).
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field.join(''));
      field = [];
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      line++;
      row.push(field.join(''));
      field = [];
      rows.push({ cells: row, line: rowLine });
      row = [];
      rowLine = line;
    } else {
      field.push(ch);
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.join(''));
    rows.push({ cells: row, line: rowLine });
  }
  return rows.filter((r) => r.cells.some((cell) => cell.trim() !== ''));
}

/** Parse into an array of string rows. Fully empty rows are dropped. */
export function parseCSV(text) {
  return parseCSVWithLines(text).map((r) => r.cells);
}

/**
 * Undo toCSV's formula neutralization on a cell being imported: without
 * this, a phone number like +31 6 1234 gains a permanent apostrophe on
 * every export → import cycle. Only the exact escape shape (an apostrophe
 * directly before a formula trigger) is stripped; other leading
 * apostrophes are data.
 */
export function fromCSVCell(value) {
  const s = String(value ?? '');
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

/** Serialize rows; fields with commas, quotes, or newlines get quoted. */
export function toCSV(rows) {
  const escape = (value) => {
    let s = String(value ?? '');
    // Exports carry data entered by applicants; spreadsheet apps execute
    // cells that open with a formula trigger (CWE-1236). Neutralize them
    // the way Sheets and GitHub do: a leading apostrophe, which those apps
    // hide as a plain-text marker.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n';
}
