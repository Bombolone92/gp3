import { parseModelXml, modelChildren } from './data-model-metadata.js';
import { pivotStyleDefinitions, pivotStyleDxfs } from '../vendor/pivot-style-presets.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const children = (node, name) => modelChildren(node, name, MAIN);
const fail = message => { throw new Error(`Invalid native pivot style: ${message}`); };
const one = (node, name) => { const list = children(node, name); if (list.length > 1) fail(`duplicate ${name}`); return list[0]; };
const uint = (node, name, fallback = null) => {
  if (!node.hasAttribute(name)) return fallback;
  const raw = node.getAttribute(name).trim(), n = Number(raw);
  if (!/^\+?\d+$/.test(raw) || !Number.isSafeInteger(n) || n > 4294967295) fail(name);
  return n;
};
const flag = (node, name, fallback = false) => {
  if (!node.hasAttribute(name)) return fallback;
  const raw = node.getAttribute(name).trim();
  if (!['0', '1', 'false', 'true'].includes(raw)) fail(name);
  return raw === '1' || raw === 'true';
};

// ISO 29500-1 18.8.41: pivot precedence differs from worksheet tables.
export const NATIVE_PIVOT_STYLE_ORDER = ['wholeTable', 'pageFieldLabels', 'pageFieldValues',
  'firstColumnStripe', 'secondColumnStripe', 'firstRowStripe', 'secondRowStripe',
  'firstColumn', 'headerRow', 'firstHeaderCell', 'firstSubtotalColumn', 'secondSubtotalColumn', 'thirdSubtotalColumn',
  'blankRow', 'firstSubtotalRow', 'secondSubtotalRow', 'thirdSubtotalRow',
  'firstColumnSubheading', 'secondColumnSubheading', 'thirdColumnSubheading',
  'firstRowSubheading', 'secondRowSubheading', 'thirdRowSubheading', 'lastColumn', 'totalRow'];
// These ordinary-table elements have no effect on a PivotTable (MS-XLSB TSEType).
const ignored = new Set(['lastHeaderCell', 'firstTotalCell', 'lastTotalCell']);
const levels = ['first', 'second', 'third'];
const subtotalTypes = new Set(['default', 'sum', 'countA', 'avg', 'max', 'min', 'product', 'count', 'stdDev', 'stdDevP', 'var', 'varP']);
const hierarchyParts = new Set(levels.flatMap(level => ['SubtotalRow', 'SubtotalColumn', 'RowSubheading', 'ColumnSubheading'].map(part => level + part)));
const valid = type => NATIVE_PIVOT_STYLE_ORDER.includes(type) || ignored.has(type);
const rectangle = range => {
  if (!range || !['r1', 'c1', 'r2', 'c2'].every(k => Number.isSafeInteger(range[k]))
    || range.r1 < 0 || range.c1 < 0 || range.r2 < range.r1 || range.c2 < range.c1 || range.r2 >= 1048576 || range.c2 >= 16384) fail('region bounds');
  return { r1: range.r1, c1: range.c1, r2: range.r2, c2: range.c2 };
};

/** Decode built-in and custom pivot-style references without converting native formatting to
 * a smaller paint vocabulary. The exact DXFs retain omitted vs explicit reset
 * properties, theme references, number formats and future-format extensions.
 */
export function readNativePivotStyle(pivot, native) {
  const root = parseModelXml(pivot.xml);
  if (root.namespaceURI !== MAIN || root.localName !== 'pivotTableDefinition') fail('report root');
  const info = one(root, 'pivotTableStyleInfo');
  if (!info) return null;
  const name = info.getAttribute('name') || '';
  const options = Object.fromEntries(['showRowHeaders', 'showColHeaders', 'showRowStripes', 'showColStripes', 'showLastColumn'].map(k => [k, flag(info, k)]));
  if (!name) return { name, options, elements: [] };
  const matches = (native.styles || []).filter(style => style.name === name);
  const preset = Object.hasOwn(pivotStyleDefinitions, name) ? pivotStyleDefinitions[name] : null;
  if (!matches.length && !preset) throw new Error(`Missing pivot style definitions are not implemented: ${name}`);
  if (matches.length > 1) fail('ambiguous style name');
  let definition = parseModelXml(matches.length ? matches[0].xml : preset);
  if (definition.namespaceURI !== MAIN || definition.localName !== 'tableStyle' || definition.getAttribute('name') !== name || !flag(definition, 'pivot', true)) fail('style definition');
  let parts = children(definition, 'tableStyleElement'), dxfs = native.dxfs;
  if (uint(definition, 'count', parts.length) !== parts.length) fail('element count');
  // ISO 29500-1 18.8.40 / Annex G: built-in definitions can be omitted or
  // represented by a name-only tableStyle. Explicit custom elements still win.
  if (preset && (!matches.length || !parts.length)) {
    definition = parseModelXml(preset);
    parts = children(definition, 'tableStyleElement');
    dxfs = pivotStyleDxfs;
  }
  const used = new Set(), decoded = new Map();
  const elements = parts.map(part => {
    const type = part.getAttribute('type');
    if (!valid(type) || used.has(type)) fail('duplicate or unknown element type');
    used.add(type);
    const id = uint(part, 'dxfId'), size = uint(part, 'size', 1);
    if (id != null && !decoded.has(id)) {
      const xml = dxfs?.[id]; if (!xml) fail('missing differential format');
      const dxf = parseModelXml(xml);
      if (dxf.namespaceURI !== MAIN || dxf.localName !== 'dxf') fail('differential format root');
      decoded.set(id, xml);
    }
    return { type, size, dxf: id == null ? null : decoded.get(id) };
  });
  return { name, options, elements };
}

/** Ordered native differential layers over semantic rectangles. Ordering comes
 * from the standard, never XML declaration order. Border application must use
 * each region's bounds to distinguish its outside and inside edges.
 */
export function nativePivotStyleLayers(style, regions, { maxRegions = 1048576 } = {}) {
  if (!Number.isSafeInteger(maxRegions) || maxRegions < 0 || !Array.isArray(regions) || regions.length > maxRegions) fail('region limit');
  const grouped = new Map();
  for (const region of regions) {
    if (!valid(region.type)) fail('region type');
    const range = rectangle(region.range);
    if (!grouped.has(region.type)) grouped.set(region.type, []);
    grouped.get(region.type).push(range);
  }
  const elements = new Map((style?.elements || []).map(element => [element.type, element]));
  return NATIVE_PIVOT_STYLE_ORDER.flatMap(type => {
    const dxf = elements.get(type)?.dxf;
    return dxf == null ? [] : (grouped.get(type) || []).map(range => ({ type, range, dxf }));
  });
}

/** Body regions from rebuilt semantic axes, before worksheet-style composition.
 * Page controls live outside the body. Row subheadings occupy their own rows in
 * compact/outline layouts; shared tabular headings and column headings need
 * their own cell geometry and remain explicit unsupported work.
 */
export function nativePivotBodyStyleLayers(layout, style, options = {}) {
  const body = rectangle(layout.range), dataRow = body.r1 + layout.firstDataRow, dataCol = body.c1 + layout.firstDataCol;
  if (![layout.firstDataRow, layout.firstDataCol].every(n => Number.isSafeInteger(n) && n >= 0)
    || dataRow > body.r2 + 1 || dataCol > body.c2 + 1
    || dataRow + layout.rows.items.length > body.r2 + 1 || dataCol + layout.columns.items.length > body.c2 + 1) fail('body offsets');
  const supported = new Set(['wholeTable', 'headerRow', 'firstColumn', 'firstHeaderCell', 'blankRow', 'totalRow', 'lastColumn', 'pageFieldLabels', 'pageFieldValues', ...ignored, ...hierarchyParts]);
  for (const part of style?.elements || []) if (part.dxf != null && !supported.has(part.type)) {
    if (part.type.endsWith('RowStripe') && !style.options.showRowStripes || part.type.endsWith('ColumnStripe') && !style.options.showColStripes) continue;
    throw new Error(`Pivot style ${part.type} region layout is not implemented`);
  }
  const maxRegions = options.maxRegions ?? 1048576;
  if (!Number.isSafeInteger(maxRegions) || maxRegions < 0) fail('region limit');
  const active = new Set((style?.elements || []).filter(p => p.dxf != null).map(p => p.type));
  const regions = [], flags = style?.options || {};
  const add = (type, range) => {
    if (!active.has(type)) return;
    if (regions.length >= maxRegions) fail('region limit');
    regions.push({ type, range });
  };
  add('wholeTable', body);
  if (flags.showRowHeaders && dataCol > body.c1) add('firstColumn', { ...body, c2: dataCol - 1 });
  if (flags.showColHeaders && dataRow > body.r1) {
    add('headerRow', { ...body, r2: dataRow - 1 });
    if (flags.showRowHeaders && dataCol > body.c1) add('firstHeaderCell', { ...body, r2: dataRow - 1, c2: dataCol - 1 });
  }
  if (active.has('totalRow') || active.has('blankRow')) for (const [i, row] of layout.rows.items.entries()) {
    if (row.type === 'grand' || row.type === 'blank') add(row.type === 'grand' ? 'totalRow' : 'blankRow', { ...body, r1: dataRow + i, r2: dataRow + i });
  }
  if (flags.showLastColumn && active.has('lastColumn')) for (const [i, col] of layout.columns.items.entries()) {
    if (col.type === 'grand') add('lastColumn', { ...body, c1: dataCol + i, c2: dataCol + i });
  }
  for (const axisName of ['rows', 'columns']) {
    const rowAxis = axisName === 'rows', subtotal = rowAxis ? 'SubtotalRow' : 'SubtotalColumn', heading = rowAxis ? 'RowSubheading' : 'ColumnSubheading';
    const useTotals = levels.some(level => active.has(level + subtotal));
    const useHeadings = (rowAxis ? flags.showRowHeaders : flags.showColHeaders) && levels.some(level => active.has(level + heading));
    if (!useTotals && !useHeadings) continue;
    const axis = layout[axisName];
    if (!Array.isArray(axis.fields) || axis.fields.length > 128 || new Set(axis.fields).size !== axis.fields.length
      || axis.fields.some(field => field !== -2 && (!Number.isSafeInteger(field) || field < 0 || !layout.fields?.[field]))) fail('hierarchy fields');
    const dimensions = axis.fields.filter(field => field !== -2);
    if (!dimensions.length) continue;
    if (useHeadings && !rowAxis) throw new Error('Pivot style column subheading region layout is not implemented');
    if (useHeadings && dimensions.length > 1 && dimensions.slice(0, -1).some(field => layout.fields[field].outline === false)) {
      throw new Error('Pivot style tabular subheading region layout is not implemented');
    }
    for (const [i, entry] of axis.items.entries()) {
      const isTotal = subtotalTypes.has(entry.type);
      if (!isTotal && entry.type !== 'data') continue;
      // Leaf members are ordinary data, even when the style defines headings
      // for more deeply nested reports. Never turn every label into a heading.
      if (!isTotal && (!useHeadings || entry.members?.length === dimensions.length)) continue;
      if (isTotal && !useTotals) continue;
      const members = entry.members;
      if (!Array.isArray(members) || !members.length || members.length > dimensions.length
        || members.some((member, depth) => member.field !== dimensions[depth] || member.type === 'subtotal')) fail('unresolved hierarchy member');
      const depth = members.length - 1;
      if (isTotal && entry.subtotalField != null && entry.subtotalField !== dimensions[depth]) fail('subtotal field');
      // MS-XLSB 2.5.150: the outermost field has its own style; deeper
      // fields alternate second/third, rather than cycling through all three.
      // Above-group aggregate rows remain subheadings, not below-group totals.
      const level = depth === 0 ? 'first' : depth % 2 ? 'second' : 'third';
      const range = rowAxis ? { ...body, r1: dataRow + i, r2: dataRow + i } : { ...body, c1: dataCol + i, c2: dataCol + i };
      add(level + (isTotal ? subtotal : heading), range);
    }
  }
  return nativePivotStyleLayers(style, regions, options);
}
