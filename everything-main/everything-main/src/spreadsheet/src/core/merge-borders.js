import { borderCss } from './format.js';

/** A merge hides interior edges, not the formatting of its perimeter cells.
 * Hidden/clipped lines contribute neither ink nor length. Returned segments
 * use fractions of the visible merged box, so consumers can scale its layout.
 * Work is proportional to the perimeter, never the merged area. */
export function mergeBorderSegments(merge, rows, cols, rowSize, colSize, styleAt, geometry = {}) {
  const result = [];
  const axis = (lines, size, position, extent) => {
    if (position && extent > 0) return lines.map(n => [n, position(n) / extent, (position(n) + size(n)) / extent]);
    let total = 0;
    const positions = lines.map(n => { const start = total; total += size(n); return [n, start, total]; });
    return total > 0 ? positions.map(([n, start, end]) => [n, start / total, end / total]) : [];
  };
  const horizontal = axis(cols, colSize, geometry.colPosition, geometry.width);
  const vertical = axis(rows, rowSize, geometry.rowPosition, geometry.height);
  const sides = [
    ['bt', rows.includes(merge.r1), horizontal, c => [merge.r1, c]],
    ['bb', rows.includes(merge.r2), horizontal, c => [merge.r2, c]],
    ['bl', cols.includes(merge.c1), vertical, r => [r, merge.c1]],
    ['br', cols.includes(merge.c2), vertical, r => [r, merge.c2]],
  ];
  for (const [side, visible, positions, cell] of sides) {
    if (!visible) continue;
    for (const [n, start, end] of positions) {
      if (!(end > start)) continue;
      const st = styleAt(...cell(n));
      if (!st?.[side]) continue;
      const css = borderCss(st[`${side}Border`] || st);
      const previous = result.at(-1);
      if (previous?.side === side && previous.end === start && previous.width === css.width && previous.style === css.style && previous.color === css.color) previous.end = end;
      else result.push({ side, start, end, ...css });
    }
  }
  return result;
}
