// CSV parsing and splitting spreadsheet ranges into board tables. Board
// tables hold at most 20 rows, 12 columns, and 2,000 characters per cell.
import { columnName } from "../src/content/providers.js";

export const TABLE_ROWS = 20;
export const TABLE_COLUMNS = 12;
export const CELL_CHARACTERS = 2000;
export const MAX_TABLES = 40;
const CSV_ROWS = 5000,
  CSV_COLUMNS = 500;

function delimiter(text) {
  // Blank lines and a line cut off by the sample size say nothing about the
  // delimiter.
  const lines = text.slice(0, 4096).split("\n");
  if (text.length > 4096 && lines.length > 1) lines.pop();
  const sample = lines.filter((line) => line.trim()).slice(0, 5);
  if (!sample.length) return ",";
  // Delimiters inside quoted values do not count, and a tie with a comma
  // goes to the other delimiter: commas also appear in text and in decimal
  // numbers written the French way.
  const unquoted = sample.map((line) => line.replace(/"(?:[^"]|"")*"/g, ""));
  let best = ",",
    score = 0;
  for (const d of [",", ";", "\t", "|"]) {
    const counts = unquoted.map((line) => line.split(d).length - 1);
    const s = Math.min(...counts) > 0 ? counts[0] : 0;
    if (s > score || (s && s === score && best === ",")) {
      best = d;
      score = s;
    }
  }
  return best;
}

// RFC 4180 with quoted delimiters, doubled quotes, and embedded newlines.
export function parseCSV(text, separator) {
  text = text.replace(/^\ufeff/, "").replace(/\r\n?/g, "\n");
  const d = separator || delimiter(text);
  const rows = [];
  let row = [],
    value = "",
    quoted = false,
    truncated = false;
  const push = () => {
    if (row.length < CSV_COLUMNS) row.push(value);
    else truncated = true;
    value = "";
  };
  for (let n = 0; n < text.length; n++) {
    const char = text[n];
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[n + 1] === '"') {
        value += '"';
        n++;
      } else quoted = false;
    } else if (char === '"' && value === "") quoted = true;
    else if (char === d) push();
    else if (char === "\n") {
      push();
      rows.push(row);
      row = [];
      if (rows.length >= CSV_ROWS) {
        truncated ||= n < text.length - 1;
        break;
      }
    } else value += char;
  }
  if (value || row.length) {
    push();
    rows.push(row);
  }
  return { rows, truncated };
}

// Removes empty trailing rows and columns and pads to a rectangle.
export function trimRows(rows) {
  const filled = rows.map((row) => (row || []).map((v) => String(v ?? "")));
  while (filled.length && !filled.at(-1).some((v) => v.trim())) filled.pop();
  const width = Math.max(
    0,
    ...filled.map((row) => {
      let n = row.length;
      while (n && !row[n - 1].trim()) n--;
      return n;
    }),
  );
  return filled.map((row) =>
    Array.from({ length: width }, (_, c) => row[c] ?? ""),
  );
}

// Splits rows into table-sized chunks. In "split" mode the first row is a
// header repeated on every vertical chunk; "first" keeps one table.
// Each chunk carries its A1 source range for refreshing from Google Sheets.
export function splitTable(input, { mode = "split", header = true } = {}) {
  const rows = trimRows(input);
  const result = {
    tables: [],
    truncatedCells: 0,
    omittedRows: 0,
    omittedColumns: 0,
    rows: rows.length,
    columns: rows[0]?.length || 0,
  };
  if (!rows.length || !result.columns) return result;
  const cut = (value) => {
    if (value.length <= CELL_CHARACTERS) return value;
    result.truncatedCells++;
    return value.slice(0, CELL_CHARACTERS - 1) + "…";
  };
  const hasHeader = header && rows.length > 1;
  const bodyRows = hasHeader ? TABLE_ROWS - 1 : TABLE_ROWS;
  const body = hasHeader ? rows.slice(1) : rows;
  const vertical = mode === "first" ? 1 : Math.ceil(body.length / bodyRows);
  const horizontal =
    mode === "first" ? 1 : Math.ceil(result.columns / TABLE_COLUMNS);
  // Only rows of tables that can be finished are started, so rows left out
  // are left out across every column and counted as such.
  const fit = Math.max(1, Math.floor(MAX_TABLES / horizontal));
  for (let v = 0; v < Math.min(vertical, fit); v++)
    for (let h = 0; h < horizontal; h++) {
      if (result.tables.length >= MAX_TABLES) break;
      const left = h * TABLE_COLUMNS,
        right = Math.min(result.columns, left + TABLE_COLUMNS);
      const start = v * bodyRows,
        chunk = body.slice(start, start + bodyRows);
      if (!chunk.length && v) continue;
      const cells = [...(hasHeader ? [rows[0]] : []), ...chunk].map((row) =>
        row.slice(left, right).map(cut),
      );
      // Source rows are 1-based and include the header row when present.
      const top = (hasHeader ? 2 : 1) + start,
        bottom = top + chunk.length - 1;
      const range =
        v === 0 && hasHeader
          ? `${columnName(left)}1:${columnName(right - 1)}${Math.max(1, bottom)}`
          : `${columnName(left)}${top}:${columnName(right - 1)}${Math.max(top, bottom)}`;
      result.tables.push({
        cells,
        row: v,
        column: h,
        range,
        header: hasHeader,
      });
    }
  const coveredRows = Math.min(
    body.length,
    (mode === "first" ? 1 : Math.ceil(result.tables.length / horizontal)) *
      bodyRows,
  );
  result.omittedRows = Math.max(0, body.length - coveredRows);
  // Columns reach as far as the rightmost table that was made.
  const coveredColumns = Math.min(
    result.columns,
    Math.max(0, ...result.tables.map((t) => (t.column + 1) * TABLE_COLUMNS)),
  );
  result.omittedColumns = Math.max(0, result.columns - coveredColumns);
  return result;
}

// Cells for a stored A1 range, used when refreshing a Google Sheets table.
// Ranges below the header row get the header prepended again. A range with
// spare table rows grows with the sheet; full chunks cannot, so refreshed
// chunks never overlap. Returns the cells and the range they now cover.
export function rangeCells(input, range, header = true) {
  const rows = trimRows(input);
  // A stored range can name more columns than a table holds, as when a
  // board file was edited; the table keeps the columns it can.
  const { top, left } = range,
    right = Math.min(range.right, left + TABLE_COLUMNS - 1);
  const pick = (row) =>
    Array.from({ length: right - left + 1 }, (_, c) => {
      const value = row?.[left + c] ?? "";
      return value.length > CELL_CHARACTERS
        ? value.slice(0, CELL_CHARACTERS - 1) + "…"
        : value;
    });
  const out = header && top > 0 ? [pick(rows[0])] : [];
  const capacity = TABLE_ROWS - out.length;
  const bottom = Math.max(top, Math.min(rows.length - 1, top + capacity - 1));
  for (let r = top; r <= bottom; r++) out.push(pick(rows[r]));
  return {
    cells: out,
    range: `${columnName(left)}${top + 1}:${columnName(right)}${bottom + 1}`,
  };
}
