// A1 chart source ranges, including quoted sheet names and row-oriented data.
// SpreadsheetML worksheet limits are format constraints, not cache point limits.
export const XLSX_MAX_ROWS = 1048576,
  XLSX_MAX_COLUMNS = 16384;
export interface WorkbookCellAddress {
  readonly row: number;
  readonly col: number;
}
export interface WorkbookRange {
  readonly sheet: string;
  readonly prefix: string;
  readonly start: WorkbookCellAddress;
  readonly end: WorkbookCellAddress;
  readonly startToken: string;
  readonly rowAbsolute: boolean;
  readonly colAbsolute: boolean;
}
export const columnName = (col: number): string => {
  let name = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};
export const cellAddress = (raw: string | null): WorkbookCellAddress | null => {
  const m = raw?.match(/^\$?([A-Za-z]{1,3})\$?([1-9]\d*)$/);
  if (!m) return null;
  let col = 0;
  for (const letter of m[1]!.toUpperCase())
    col = col * 26 + letter.charCodeAt(0) - 64;
  const row = Number(m[2]);
  return col <= XLSX_MAX_COLUMNS && row <= XLSX_MAX_ROWS
    ? { col: col - 1, row: row - 1 }
    : null;
};
export const cellName = ({ row, col }: WorkbookCellAddress): string =>
  `${columnName(col)}${row + 1}`;
export const workbookRange = (formula: string): WorkbookRange | null => {
  const m = formula.match(
    /^(=?('(?:[^']|'')+'|[^'!]+)!)((\$?)[A-Za-z]{1,3}(\$?)[1-9]\d*)(?::(\$?[A-Za-z]{1,3}\$?[1-9]\d*))?$/,
  );
  if (!m) return null;
  const sheet = m[2]!.startsWith("'")
    ? m[2]!.slice(1, -1).replace(/''/g, "'")
    : m[2]!;
  if (/[\[\]:]/.test(sheet)) return null;
  const start = cellAddress(m[3]!),
    end = cellAddress(m[6] ?? m[3]!);
  if (!start || !end || end.row < start.row || end.col < start.col) return null;
  return {
    sheet,
    prefix: m[1]!,
    start,
    end,
    startToken: m[3]!,
    colAbsolute: (m[6] ?? m[3]!).startsWith("$"),
    rowAbsolute: /\$[1-9]\d*$/.test(m[6] ?? m[3]!),
  };
};
export const rangeLength = (r: WorkbookRange): number | null =>
  r.start.col === r.end.col
    ? r.end.row - r.start.row + 1
    : r.start.row === r.end.row
      ? r.end.col - r.start.col + 1
      : null;
export const rangeCell = (
  r: WorkbookRange,
  index: number,
): WorkbookCellAddress => ({
  row: r.start.row + (r.start.col === r.end.col ? index : 0),
  col: r.start.col + (r.start.col === r.end.col ? 0 : index),
});
export const resizedRange = (
  r: WorkbookRange,
  length: number,
): string | null => {
  if (length < 1 || rangeLength(r) === null) return null;
  const end = rangeCell(r, length - 1);
  if (end.row >= XLSX_MAX_ROWS || end.col >= XLSX_MAX_COLUMNS) return null;
  if (length === 1) return r.prefix + r.startToken;
  return `${r.prefix}${r.startToken}:${r.colAbsolute ? "$" : ""}${columnName(end.col)}${r.rowAbsolute ? "$" : ""}${end.row + 1}`;
};
export const quotedSheet = (name: string): string =>
  `'${name.replace(/'/g, "''")}'`;
