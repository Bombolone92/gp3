import { BORDER_STYLE_KEYS } from './style-values.js';
import { intersection, forEachRangeRecordIn } from './range-records.js';

/** A complete border snapshot, independent of shared/per-side storage. */
export function borderSnapshot(style, { color = undefined, style: weight = undefined } = {}) {
  const out = { bc: null, bs: null };
  for (const side of ['bt', 'bb', 'bl', 'br']) {
    out[side] = !!style?.[side];
    const edge = style?.[`${side}Border`] || style;
    out[`${side}Border`] = out[side] ? {
      bs: weight !== undefined ? weight || 'thin' : edge?.bs || 'thin',
      bc: color !== undefined ? color || null : edge?.bc || null,
    } : null;
  }
  return out;
}

const hasBorder = style => style && (style.bt || style.bb || style.bl || style.br);
const borderPatch = style => Object.fromEntries(BORDER_STYLE_KEYS.filter(k => Object.hasOwn(style, k)).map(k => [k, style[k]]));

// Adjacent lines with the same border patch form one run. Unrelated fonts,
// fills and number formats must not fragment the border geometry.
function lineCuts(styles, first, last) {
  const cuts = new Set([first, last + 1]);
  let previous;
  const flush = () => { if (previous) { cuts.add(previous.first); cuts.add(previous.last + 1); } };
  const entries = last - first + 1 < styles.size
    ? Array.from({ length: last - first + 1 }, (_, n) => [first + n, styles.get(first + n)]).filter(([, st]) => st)
    : [...styles].filter(([i]) => i >= first && i <= last).sort(([a], [b]) => a - b);
  for (const [i, style] of entries) {
    const patch = borderPatch(style);
    if (!Object.keys(patch).length) continue;
    const signature = JSON.stringify(patch);
    if (previous && previous.last + 1 === i && previous.signature === signature) previous.last = i;
    else { flush(); previous = { first: i, last: i, signature }; }
  }
  flush();
  return cuts;
}

/** Changed inherited borders as disjoint, coalesced rectangles. Reads occur at
 * format boundaries, never at every empty cell of the selected rectangle.
 * `before` is an immutable line/exception snapshot; `afterAt` can include a
 * whole-line default edit, avoiding redundant million-cell native exceptions. */
export function* changedBorderRegions(before, area, beforeAt, afterAt, transform, extraCuts = {}, stateOf = borderSnapshot) {
  const rowCuts = lineCuts(before.rowStyles, area.r1, area.r2);
  const colCuts = lineCuts(before.colStyles, area.c1, area.c2);
  for (const r of extraCuts.rows || []) if (r > area.r1 && r <= area.r2) rowCuts.add(r);
  for (const c of extraCuts.cols || []) if (c > area.c1 && c <= area.c2) colCuts.add(c);
  forEachRangeRecordIn(before.styleResets, area, record => {
    if (!record.keys.some(k => BORDER_STYLE_KEYS.includes(k))) return;
    const cut = intersection(record.range, area);
    if (!cut) return;
    rowCuts.add(cut.r1); rowCuts.add(cut.r2 + 1);
    colCuts.add(cut.c1); colCuts.add(cut.c2 + 1);
  });
  const rows = [...rowCuts].sort((a, b) => a - b), cols = [...colCuts].sort((a, b) => a - b);
  let previous = new Map();
  for (let i = 0; i < rows.length - 1; i++) {
    const r1 = rows[i], r2 = rows[i + 1] - 1, current = new Map();
    let run;
    const finish = () => {
      if (!run) return;
      const key = `${run.signature}:${run.range.c1},${run.range.c2}`;
      const older = previous.get(key);
      if (older && older.range.r2 + 1 === r1) { older.range.r2 = r2; current.set(key, older); previous.delete(key); }
      else current.set(key, run);
      run = null;
    };
    for (let j = 0; j < cols.length - 1; j++) {
      const c1 = cols[j], c2 = cols[j + 1] - 1, inherited = beforeAt(r1, c1);
      const values = transform(inherited, r1, c1);
      if (!values) { finish(); continue; }
      const signature = JSON.stringify(stateOf(values));
      if (signature === JSON.stringify(stateOf(afterAt(r1, c1)))) { finish(); continue; }
      if (run?.signature === signature && run.range.c2 + 1 === c1) run.range.c2 = c2;
      else { finish(); run = { range: { r1, c1, r2, c2 }, values, signature }; }
    }
    finish();
    for (const { range, values } of previous.values()) yield { range, values };
    previous = current;
  }
  for (const { range, values } of previous.values()) yield { range, values };
}

export function* restyledBorderRegions(before, area, beforeAt, afterAt, options) {
  yield* changedBorderRegions(before, area, beforeAt, afterAt,
    inherited => hasBorder(inherited) ? borderSnapshot(inherited, options) : null);
}

/** Whole-column outlines have no top/bottom cap. Whole-row formatting can
 * reach the first column, but does not add an edge at the final file column.
 * Select All has no outside edges. The file stores the repeated part as a line
 * XF, independently of used cells. */
export function borderPaintSides(kind, area, r, c, { wholeCols = false, wholeRows = false } = {}) {
  const edge = { bt: !wholeCols && r === area.r1, bb: !wholeCols && r === area.r2,
    bl: !(wholeCols && wholeRows) && c === area.c1, br: !wholeRows && c === area.c2 };
  if (kind === 'all') return ['bt', 'bb', 'bl', 'br'];
  if (kind === 'outer') return Object.keys(edge).filter(k => edge[k]);
  if (kind === 'inner') return Object.keys(edge).filter(k => !edge[k]);
  if (kind === 'horizontal') return ['bt', 'bb'].filter(k => !edge[k]);
  if (kind === 'vertical') return ['bl', 'br'].filter(k => !edge[k]);
  const side = { top: 'bt', bottom: 'bb', left: 'bl', right: 'br' }[kind];
  return side && edge[side] ? [side] : [];
}

/** Painting also retains the shared pen and inactive descriptors: those
 * determine the appearance of sides added by a later command. */
export function borderPaintState(style) {
  const out = { bc: style?.bc || null, bs: style?.bs || 'thin' };
  for (const side of ['bt', 'bb', 'bl', 'br']) {
    out[side] = !!style?.[side];
    const edge = style?.[`${side}Border`];
    out[`${side}Border`] = edge ? { bs: edge.bs || 'thin', bc: edge.bc || null } : null;
  }
  return out;
}

export function borderPaintPatch(style, area, r, c, kind, options, lines) {
  const sides = borderPaintSides(kind, area, r, c, lines);
  if (!sides.length && ['top', 'bottom', 'left', 'right'].includes(kind)) return null;
  // Dialog edge gestures use independent pens. Keep the legacy shared-pen
  // commands unchanged, including their intentional repaint of existing sides.
  if (options.perSide || options.remove) {
    if (!sides.length) return null;
    const out = borderPatch(style || {});
    for (const side of sides) {
      out[side] = !options.remove;
      const pen = style?.[`${side}Border`] || style;
      out[`${side}Border`] = options.remove ? null : {
        bs: options.style !== undefined ? options.style || 'thin' : pen?.bs || 'thin',
        bc: options.color !== undefined ? options.color || null : pen?.bc || null,
      };
    }
    return out;
  }
  const out = { ...borderPatch(style || {}), ...Object.fromEntries(sides.map(k => [k, true])) };
  if (hasBorder(out)) {
    for (const [key, value] of [['bc', options.color], ['bs', options.style]]) if (value !== undefined) {
      if (!value || key === 'bs' && value === 'thin') delete out[key]; else out[key] = value;
      for (const side of ['bt', 'bb', 'bl', 'br']) if (out[`${side}Border`]) {
        out[`${side}Border`] = { ...out[`${side}Border`], [key]: value || (key === 'bs' ? 'thin' : null) };
      }
    }
  } else { delete out.bc; delete out.bs; }
  return out;
}

export function paintedBorder(style, area, r, c, kind, options, lines) {
  const patch = borderPaintPatch(style, area, r, c, kind, options, lines);
  return patch && (options.perSide || options.remove || hasBorder(patch)) ? borderPaintState(patch) : null;
}

/** Resolve a finite, unmerged border gesture to explicit cell-side edits.
 * Named pens repaint existing active sides too, matching applyBorders. Omitted
 * sides remain absent from the patch so unrelated native rules can inherit.
 */
export function cellBorderGesturePatch(style, area, r, c, kind, options = {}) {
  if (kind === 'none') return Object.fromEntries(BORDER_STYLE_KEYS.map(key => [key, null]));
  const repaint = options.color !== undefined || options.style !== undefined;
  const sides = kind === 'restyle' ? [] : borderPaintSides(kind, area, r, c);
  if (!sides.length && ['top', 'bottom', 'left', 'right'].includes(kind)) return null;
  if (options.perSide || options.remove) {
    if (!sides.length) return null;
    const out = {};
    for (const side of sides) {
      const pen = style?.[`${side}Border`] || style;
      out[side] = options.remove ? null : true;
      out[`${side}Border`] = options.remove ? null : {
        bs: options.style !== undefined ? options.style || 'thin' : pen?.bs || 'thin',
        bc: options.color !== undefined ? options.color || null : pen?.bc || null,
      };
    }
    return out;
  }
  const touched = new Set(sides);
  if (repaint) for (const side of ['bt', 'bb', 'bl', 'br']) if (style?.[side]) touched.add(side);
  if (!touched.size) return null;
  const out = {};
  if (options.color !== undefined) out.bc = options.color || null;
  if (options.style !== undefined) out.bs = options.style || null;
  for (const side of touched) {
    const pen = style?.[`${side}Border`] || style;
    out[side] = true;
    out[`${side}Border`] = {
      bs: options.style !== undefined ? options.style || 'thin' : pen?.bs || 'thin',
      bc: options.color !== undefined ? options.color || null : pen?.bc || null,
    };
  }
  return out;
}
