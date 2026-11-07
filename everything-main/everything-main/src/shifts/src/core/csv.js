/**
 * CSV reading, the other half of the writer in timesheet.js.
 *
 * Everyone this app is for is coming from a spreadsheet, so the reader
 * has to survive what spreadsheets actually produce: quoted fields with
 * commas and line breaks inside them, doubled quotes, CRLF endings, a
 * byte-order mark, and the apostrophe this app's own exporter adds in
 * front of a cell that would otherwise be read as a formula.
 */

/**
 * Splits CSV text into rows of raw cell strings. Never throws: anything
 * unterminated is taken as ending at the end of the text, which is what
 * a truncated file looks like and is better reported per row than as a
 * failure to read the file at all.
 */
export function parseCSV(text) {
  const input = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === '') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // CRLF is one break, not two.
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Trimmed, with the exporter's anti-formula apostrophe taken back off. */
export function cleanCell(value) {
  const text = String(value ?? '').trim();
  return text.startsWith("'") ? text.slice(1) : text;
}

const isBlankRow = (row) => row.every((cell) => cleanCell(cell) === '');

/**
 * A CSV as a header row plus data rows, blank lines dropped. A file with
 * two tables in it (the timesheet export has a detail table and a
 * summary block) keeps both: the second table's rows come through as
 * ordinary rows and are reported as row-level problems rather than
 * making the whole file unreadable.
 *
 * `lineNumbers` carries each row's position in the file, so a problem
 * can be pointed at the line it came from.
 */
export function parseCSVTable(text) {
  const all = parseCSV(text);
  let headers = null;
  const rows = [];
  const lineNumbers = [];
  all.forEach((row, index) => {
    if (isBlankRow(row)) return;
    if (headers === null) {
      headers = row.map(cleanCell);
      return;
    }
    rows.push(row);
    lineNumbers.push(index + 1);
  });
  return { headers: headers ?? [], rows, lineNumbers };
}
