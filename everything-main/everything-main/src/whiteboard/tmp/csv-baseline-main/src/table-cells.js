import {
  cellsText,
  pasteTable,
  fitsTable,
  TABLE_LIMIT,
} from "./bulk-content.js";
import {
  authoredTextHTML,
  languageAttribute,
} from "./accessibility/object-content.js";
import { tableCellContent } from "./table-language.js";
import { tableLayout } from "./table-layout.js";

export const sameTableShape = (a, b) =>
  Array.isArray(a) &&
  Array.isArray(b) &&
  a.length === b.length &&
  a.every(
    (row, r) =>
      Array.isArray(row) && Array.isArray(b[r]) && row.length === b[r].length,
  );
// Where each item of `from` went in `to`, matching equal items in order
// (their longest common subsequence); unmatched items map to undefined.
function alignment(from, to) {
  const key = (v) => JSON.stringify(v),
    a = from.map(key),
    b = to.map(key);
  const lengths = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lengths[i][j] =
        a[i] === b[j]
          ? lengths[i + 1][j + 1] + 1
          : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
  const map = new Array(a.length);
  for (let i = 0, j = 0; i < a.length && j < b.length;)
    if (a[i] === b[j]) map[i++] = j++;
    else if (lengths[i + 1][j] >= lengths[i][j + 1]) i++;
    else j++;
  return map;
}
const columns = (cells) => cells[0].map((_, c) => cells.map((row) => row[c]));
export function tableCellMapping(before, remote) {
  if (sameTableShape(before, remote))
    return { rows: before.map((_, r) => r), cols: before[0].map((_, c) => c) };
  const sameColumns = remote[0]?.length === before[0].length,
    sameRows = remote.length === before.length;
  if (!sameColumns && !sameRows) return null;
  const identity = (n) => Array.from({ length: n }, (_, i) => i);
  // Rows or columns that look alike, such as empty ones, cannot be told
  // apart, so an edit follows its row or column only when it is the one
  // of its kind on both sides.
  const unique = (from, to) => {
    const count = (list) => {
      const seen = new Map();
      for (const v of list) {
        const k = JSON.stringify(v);
        seen.set(k, (seen.get(k) || 0) + 1);
      }
      return seen;
    };
    const a = count(from),
      b = count(to);
    return alignment(from, to).map((to, n) => {
      const k = JSON.stringify(from[n]);
      return a.get(k) === 1 && b.get(k) === 1 ? to : undefined;
    });
  };
  const rows = sameColumns ? unique(before, remote) : identity(before.length),
    cols = sameColumns
      ? identity(before[0].length)
      : unique(columns(before), columns(remote));
  return { rows, cols };
}
export function rebaseCells(local, before, remote) {
  if (!sameTableShape(local, before)) return structuredClone(local);
  if (!sameTableShape(remote, before)) {
    // Someone else added or removed rows or columns. Their table stands,
    // and each cell edited here goes to where its row or column is now,
    // unless it cannot be found or they changed that cell too.
    const result = structuredClone(remote);
    const mapping = tableCellMapping(before, remote);
    if (!mapping) return result;
    const { rows, cols } = mapping;
    before.forEach((row, r) =>
      row.forEach((value, c) => {
        const rr = rows[r],
          cc = cols[c];
        if (
          local[r][c] !== value &&
          rr !== undefined &&
          cc !== undefined &&
          remote[rr][cc] === value
        )
          result[rr][cc] = local[r][c];
      }),
    );
    return result;
  }
  return remote.map((row, r) =>
    row.map((value, c) => (local[r][c] !== before[r][c] ? local[r][c] : value)),
  );
}
export function mergeCellDraft(local, before, remote) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (equal(local, before)) return structuredClone(remote);
  if (equal(remote, before)) return structuredClone(local);
  if (
    !sameTableShape(local, before) ||
    !sameTableShape(remote, before) ||
    local.some((row, r) =>
      row.some(
        (value, c) =>
          value !== before[r][c] &&
          remote[r][c] !== before[r][c] &&
          value !== remote[r][c],
      ),
    )
  )
    throw Error(
      "This table changed. Reopen its properties before applying these edits.",
    );
  return rebaseCells(local, before, remote);
}
export function tableCellAt(i, p, clamp = false) {
  if (i?.type !== "table" || !i.cells?.length || i.w <= 0 || i.h <= 0)
    return null;
  const layout = tableLayout(i);
  const locate = (points, value) =>
    value < 0 ? -1 : points.findIndex((edge) => edge > value) - 1;
  let r = locate(layout.y, p.y - i.y),
    c = locate(layout.x, p.x - i.x);
  if (p.y >= i.y + i.h) r = i.cells.length;
  if (p.x >= i.x + i.w) c = i.cells[0].length;
  if (
    !clamp &&
    (r < 0 || c < 0 || r >= i.cells.length || c >= i.cells[0].length)
  )
    return null;
  return {
    r: Math.max(0, Math.min(i.cells.length - 1, r)),
    c: Math.max(0, Math.min(i.cells[0].length - 1, c)),
  };
}
export function tableRange(a, b = a) {
  return {
    r: Math.min(a.r, b.r),
    c: Math.min(a.c, b.c),
    rows: Math.abs(b.r - a.r) + 1,
    cols: Math.abs(b.c - a.c) + 1,
  };
}
export function tableCellBox(i, range) {
  const { x, y } = tableLayout(i),
    c = Math.max(0, Math.min(range.c, x.length - 2)),
    r = Math.max(0, Math.min(range.r, y.length - 2));
  return {
    x: i.x + x[c],
    y: i.y + y[r],
    w: x[Math.min(x.length - 1, c + (range.cols || 1))] - x[c],
    h: y[Math.min(y.length - 1, r + (range.rows || 1))] - y[r],
  };
}
export function tableRangeClipboard(cells, range, table = { cells }) {
  const selected = cells
    .slice(range.r, range.r + range.rows)
    .map((row) => row.slice(range.c, range.c + range.cols));
  return {
    "text/plain": cellsText(selected),
    "text/html": `<table${languageAttribute(table.lang)}><tbody>${selected.map((row, r) => `<tr>${row.map((_, c) => `<td${languageAttribute(tableCellContent(table, range.r + r, range.c + c, false).lang)}>${authoredTextHTML(tableCellContent(table, range.r + r, range.c + c, false)).replaceAll("\n", "<br>")}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
  };
}
export function fillTableRange(cells, range, value = "") {
  return cells.map((row, r) =>
    row.map((cell, c) =>
      r >= range.r &&
      r < range.r + range.rows &&
      c >= range.c &&
      c < range.c + range.cols
        ? value
        : cell,
    ),
  );
}
export function pasteTableRange(cells, incoming, range) {
  if (!fitsTable(incoming)) throw Error(TABLE_LIMIT);
  if (incoming.length === 1 && incoming[0].length === 1)
    return fillTableRange(cells, range, incoming[0][0]);
  return pasteTable(cells, incoming, range.r, range.c);
}
