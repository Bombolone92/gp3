import { cellKey, parseKey } from './cell.js';
import { parseRefText, MAX_ROW, MAX_COL } from './refs.js';
import { nativePivotPaintAt } from './native-pivot-paint.js';
import { readNativePivotLayout } from './native-pivot-layout.js';
import { parseModelXml } from './data-model-metadata.js';
import { preservedPivotCoordinates } from './native-pivot-preserve.js';
import { FORMAT_DETAIL_KEYS } from './format.js';

const fail = reason => { throw new Error(`Cannot materialize native pivot report: ${reason}`); };
const inside = (g, r, c) => r >= g.r1 && r <= g.r2 && c >= g.c1 && c <= g.c2;
function range(ref) {
  const g = parseRefText(ref || '');
  if (!g || !['cell', 'range'].includes(g.kind) || g.r1 < 0 || g.c1 < 0 || g.r2 > MAX_ROW || g.c2 > MAX_COL) fail('invalid report range');
  return g;
}

// Compare the complete report definition except compressed axis items, whose
// semantic identities are compared separately. This also guards native formats,
// extensions and header/style settings not represented in the decoded layout.
function definition(pivot) {
  const root = parseModelXml(pivot.xml);
  const encode = node => {
    if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue;
    if (node.nodeType !== 1) return null;
    const attrs = Array.from(node.attributes)
      .map(a => [a.namespaceURI || '', a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const children = Array.from(node.childNodes).filter(child => !(node === root
      && child.namespaceURI === root.namespaceURI && ['rowItems', 'colItems'].includes(child.localName))).map(encode).filter(x => x != null);
    return [node.namespaceURI, node.localName, attrs, children];
  };
  return JSON.stringify(encode(root));
}
function preservedLayout(wb, pivot, plan, nextCache, maxCells) {
  const cache = wb.nativePivots.caches.find(c => c.key === pivot.cache);
  if (!cache) fail('missing report cache');
  nextCache ||= cache;
  if (nextCache.key !== pivot.cache) fail('mismatched preserved-format cache');
  const saved = readNativePivotLayout(pivot, cache);
  if (JSON.stringify(plan.layout) !== JSON.stringify(readNativePivotLayout(plan.pivot, nextCache))) fail('preserved-format inconsistent layout');
  if (JSON.stringify(saved) === JSON.stringify(plan.layout) && definition(pivot) === definition(plan.pivot)) return { changed: false, source: (r, c) => ({ r, c }) };
  return preservedPivotCoordinates(pivot, saved, plan.pivot, plan.layout, maxCells);
}

/** Materialize a prepared report body according to its refresh-format policy.
 * When preservation is disabled, discard direct report formats while leaving
 * worksheet/line defaults independent. Apply the pivot's compiled paint, semantic
 * indentation and field number formats to every new position, including unlabeled/blank positions. Clear only stored
 * vacated positions, so a sparse old range never becomes a dense allocation.
 *
 * For preservation, existing flat member/measure identities carry their direct
 * formats through reordering/resizing. New members use declared report paint;
 * inherited worksheet formats remain on their lines. Changed hierarchical
 * layouts need additional provenance and are rejected. Dates likewise need typed
 * date-system conversion; they are not approximated by string cells. The caller
 * still prepares page captions/conditional rules and commits the complete batch.
 */
export function materializeNativePivotReport(wb, pivot, plan, { maxCells = 1048576, nextCache = null } = {}) {
  if (!Number.isSafeInteger(maxCells) || maxCells < 0) fail('invalid cell limit');
  if (!wb.nativePivots?.tables.includes(pivot)) fail('stale report');
  const sheet = wb.sheet(pivot.owner), layout = plan?.layout;
  if (!sheet || sheet.kind === 'chart' || !layout || layout.owner !== pivot.owner || plan.pivot?.name !== pivot.name
    || plan.pivot.owner !== pivot.owner || plan.pivot.cache !== pivot.cache) fail('mismatched report');
  const preserve = layout.preserveFormatting !== false;
  if (!Array.isArray(plan.paintLayers) || !Array.isArray(plan.cells)) fail('missing paint or cell plan');
  const oldRange = range(pivot.ref), nextRange = range(plan.pivot.ref);
  if (['r1', 'c1', 'r2', 'c2'].some(key => nextRange[key] !== layout.range?.[key] || oldRange[key] !== plan.previousRange?.[key])
    || oldRange.r1 !== nextRange.r1 || oldRange.c1 !== nextRange.c1) fail('inconsistent report range');
  const size = (nextRange.r2 - nextRange.r1 + 1) * (nextRange.c2 - nextRange.c1 + 1);
  if (size > maxCells || plan.cells.length > size) fail('cell limit exceeded');
  const preservation = preserve ? preservedLayout(wb, pivot, plan, nextCache, maxCells) : null;
  const values = new Map();
  for (const cell of plan.cells) {
    if (!Number.isInteger(cell.r) || !Number.isInteger(cell.c) || !inside(nextRange, cell.r, cell.c)
      || values.has(cellKey(cell.r, cell.c))) fail('invalid or duplicate planned position');
    if (cell.type === 'date') fail('date materialization is not implemented');
    if (cell.indent != null && (!Number.isInteger(cell.indent) || cell.indent < 0 || cell.indent > 250)) fail('unrepresentable indentation');
    values.set(cellKey(cell.r, cell.c), cell);
  }
  const cells = [];
  for (let r = nextRange.r1; r <= nextRange.r2; r++) for (let c = nextRange.c1; c <= nextRange.c2; c++) {
    const value = values.get(cellKey(r, c));
    const source = preservation?.source(r, c);
    if (source) {
      const old = wb.getCell(pivot.owner, source.r, source.c);
      if (old?.f != null || old?.array != null || old?.richText != null || old?.hyperlink != null) fail('preserved-format cell content is not implemented');
      // Keep sparse direct formats and explicit resets as-is. Repainting the
      // base/native layers here would overwrite the saved user formatting.
      const cell = { ...structuredClone(old || {}), v: value?.value ?? null };
      if (preservation.changed) {
        // ISO 29500 dataField/pivotField numFmtId gives declared number formats
        // precedence when layout changes. Explicit native area formats follow.
        if (value?.numberFormat) {
          cell.s ||= {}; for (const key of FORMAT_DETAIL_KEYS) delete cell.s[key];
          Object.assign(cell.s, value.numberFormat);
        }
        if (plan.formatPaintLayers?.length) cell.s = nativePivotPaintAt(plan.formatPaintLayers, r, c, { base: cell.s });
      }
      cells.push({ r, c, cell });
      continue;
    }
    // Keep line/default formats inherited rather than baking them into a new
    // direct cell style. Explicit pivot resets still override those defaults.
    let s = nativePivotPaintAt(plan.paintLayers, r, c, { numberFormat: value?.numberFormat });
    if (value?.indent != null) s.indent = value.indent;
    // Explicit native area formats override table style, field format and layout
    // indentation. Neither layer is inferred from the old cell's flattened XF.
    if (plan.formatPaintLayers) s = nativePivotPaintAt(plan.formatPaintLayers, r, c, { base: s });
    cells.push({ r, c, cell: { v: value?.value ?? null, s } });
  }
  for (const [key, old] of sheet.cells) {
    const { r, c } = parseKey(key);
    if (preservation?.changed && inside(oldRange, r, c) && (old.f != null || old.array != null || old.richText != null || old.hyperlink != null)) fail('preserved-format cell content is not implemented');
    if (inside(oldRange, r, c) && !inside(nextRange, r, c)) {
      if (cells.length >= maxCells) fail('cell limit exceeded');
      cells.push({ r, c, cell: null });
    }
  }
  return cells;
}
