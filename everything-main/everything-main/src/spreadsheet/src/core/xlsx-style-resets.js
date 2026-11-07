/** Blank native cells needed to override inherited row/column formatting. */
// Unlike ordinary boolean flags, grouping defaults to enabled. Clearing false
// therefore changes a number format and must not be treated as a no-op.
const equivalent = (value, key) => value == null || value === false && key !== 'group' || value === '' ? null : value;
const equal = (a, b, key) => {
  a = equivalent(a, key); b = equivalent(b, key);
  return a === b || a && b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b);
};

function* linesIn(lines, lo, hi) {
  let left = 0, right = lines.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (lines[mid][0] < lo) left = mid + 1;
    else right = mid;
  }
  for (let i = left; i < lines.length && lines[i][0] <= hi; i++) yield lines[i];
}

function rowRuns(rows, keys) {
  const runs = [];
  let previous;
  for (const [r, style] of rows) {
    // Missing properties inherit the column; an explicit null masks it.
    const signature = JSON.stringify(keys.map(k => Object.hasOwn(style, k) ? [equivalent(style[k], k)] : []));
    const last = runs.at(-1);
    if (last && last.end + 1 === r && signature === previous) last.end = r;
    else runs.push({ start: r, end: r, style });
    previous = signature;
  }
  return runs;
}

function* runsIn(runs, lo, hi) {
  let left = 0, right = runs.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (runs[mid].end < lo) left = mid + 1;
    else right = mid;
  }
  for (let i = left; i < runs.length && runs[i].start <= hi; i++) yield runs[i];
}

/**
 * SpreadsheetML has no rectangle-level exception to row/column XFs. Empty
 * cleared cells therefore need their own native XF. Walk only intersections
 * with relevant line defaults, not every coordinate of a sparse reset range.
 * Yielding keeps auxiliary memory proportional to the line indexes; callers
 * can use their existing cell map to discard duplicate/intersecting records.
 */
export function* xlsxResetCells(sheet, normal = null) {
  if (!sheet.styleResets.length) return;
  const cols = [...sheet.colStyles].sort((a, b) => a[0] - b[0]);
  const rows = [...sheet.rowStyles].sort((a, b) => a[0] - b[0]);
  const relevant = (style, keys, target) => keys.some(k => Object.hasOwn(style, k)
    && !equal(style[k], target(k), k));
  const changed = (row, col, keys, target) => keys.some(k => {
    const before = row && Object.hasOwn(row, k) ? row[k] : col && Object.hasOwn(col, k) ? col[k] : normal?.[k];
    return !equal(before, target(k), k);
  });
  let previousKeys, runs;
  for (const { range: g, keys, values } of sheet.styleResets) {
    const target = k => values && Object.hasOwn(values, k) ? values[k] : normal?.[k];
    const signature = JSON.stringify(keys);
    if (signature !== previousKeys) { runs = rowRuns(rows, keys); previousKeys = signature; }
    // A concrete value can format otherwise unallocated cells with no line
    // default. Visit all column positions only in that case (at most the file
    // format's column count); row runs still skip already-equal rectangles.
    const baselineChanged = keys.some(k => !equal(normal?.[k], target(k), k));
    const columns = baselineChanged ? (function* () {
      for (let c = g.c1; c <= g.c2; c++) yield [c, sheet.colStyles.get(c)];
    })() : linesIn(cols, g.c1, g.c2);
    for (const [c, col] of columns) {
      if (!changed(null, col, keys, target)) continue;
      let next = g.r1;
      for (const run of runsIn(runs, g.r1, g.r2)) {
        // Unstyled gaps inherit the column. Grouped row overrides let us skip
        // large already-cleared rectangles without visiting each coordinate.
        for (let r = next; r < run.start; r++) yield { r, c };
        const end = Math.min(run.end, g.r2);
        if (!relevant(run.style, keys, target) && changed(run.style, col, keys, target)) {
          for (let r = Math.max(run.start, g.r1); r <= end; r++) yield { r, c };
        }
        next = end + 1;
      }
      for (let r = next; r <= g.r2; r++) yield { r, c };
    }
    // An explicit non-Normal row property wins over every column. These rows
    // were skipped above, so intersections need no duplicate records.
    for (const run of runsIn(runs, g.r1, g.r2)) {
      if (!relevant(run.style, keys, target)) continue;
      for (let r = Math.max(run.start, g.r1); r <= Math.min(run.end, g.r2); r++) {
        for (let c = g.c1; c <= g.c2; c++) yield { r, c };
      }
    }
  }
}
