import { cellKey } from './cell.js';

/**
 * Visit the stored cells of a sheet that lie in a range, by whichever walk is shorter: the range's
 * coordinates when it is small, the sheet's stored cells when the range is larger than they are. A whole
 * column is a million coordinates and the whole grid seventeen billion, so a command over a selection
 * costs what the sheet holds, never what the selection spans. `fn(r, c, cell)` is called in no particular
 * order when the stored cells are walked.
 */
export function eachStoredCell(sheet, range, fn) {
  const { r1, c1, r2, c2 } = range;
  const area = (r2 - r1 + 1) * (c2 - c1 + 1);
  if (area <= sheet.cells.size) {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      if (cell) fn(r, c, cell);
    }
    return;
  }
  for (const [key, cell] of sheet.cells) {
    const i = key.indexOf(',');
    const r = Number(key.slice(0, i));
    if (r < r1 || r > r2) continue;
    const c = Number(key.slice(i + 1));
    if (c < c1 || c > c2) continue;
    fn(r, c, cell);
  }
}

/**
 * The length of lines a..b of an axis ('row' or 'col') at their stored sizes, hidden lines (and rows a
 * filter hides) counting nothing: the default size times the lines, corrected by the few that differ,
 * so a whole column's million rows cost what its resized and hidden ones do.
 */
export function lineSpan(sheet, axis, a, b, defaultSize) {
  if (b < a) return 0;
  const sizes = axis === 'row' ? sheet.rowHeights : sheet.colWidths;
  const hidden = axis === 'row' ? sheet.hiddenRows : sheet.hiddenCols;
  const filtered = axis === 'row' ? sheet.filterHidden : null;
  const gone = (i) => hidden.has(i) || !!filtered?.has(i);
  let total = (b - a + 1) * defaultSize;
  for (const [i, size] of sizes) if (i >= a && i <= b && !gone(i)) total += size - defaultSize;
  for (const i of hidden) if (i >= a && i <= b) total -= defaultSize;
  if (filtered) for (const i of filtered) if (i >= a && i <= b && !hidden.has(i)) total -= defaultSize;
  return total;
}
