import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { effectiveColorPalette, normalizeFontColor, fontColorInPalette, tintRgb } from './font-color.js';
import { normalizeFillColor, sameFillColor } from './fill-color.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XMLNS = 'http://www.w3.org/2000/xmlns/';
const MAX_XML = 1048576;
const values = new WeakSet(), projections = new WeakMap();
const fail = () => { throw new Error('Invalid native fill resource'); };
const children = node => Array.from(node.childNodes).filter(n => n.nodeType === 1);
const root = xml => {
  if (typeof xml !== 'string' || xml.length > MAX_XML) fail();
  const node = parseModelXml(xml);
  if (node.namespaceURI !== MAIN || node.localName !== 'fill') fail();
  return node;
};
export function nativeFillRecordXml(xml) {
  if (typeof xml !== 'string' || xml.length > MAX_XML) fail();
  const node = modelChildren(parseModelXml(`<styles xmlns="${MAIN}">${xml}</styles>`), 'fill', MAIN)[0];
  if (!node) fail();
  return standaloneModelXml(node);
}
export function nativeFillIsNone(xml) {
  const node = root(xml), pattern = children(node);
  return !Array.from(node.attributes).some(a => a.namespaceURI !== XMLNS) && (!pattern.length
    || pattern.length === 1 && pattern[0].namespaceURI === MAIN && pattern[0].localName === 'patternFill'
      && ['none', ''].includes(pattern[0].getAttribute('patternType') || '') && !children(pattern[0]).length
      && !Array.from(pattern[0].attributes).some(a => a.namespaceURI !== XMLNS && a.name !== 'patternType'));
}
export function nativeFillPalette(xml, palette) {
  const full = effectiveColorPalette(palette), out = {};
  const visit = node => {
    if (node.namespaceURI === MAIN && ['fgColor', 'bgColor', 'color'].includes(node.localName)) {
      for (const key of ['theme', 'indexed']) {
        const raw = node.getAttribute(key), index = Number(raw);
        if (raw != null && /^\d+$/.test(raw) && full[key][index]) {
          const colors = out[key] ||= []; while (colors.length <= index) colors.push(null);
          colors[index] = full[key][index];
        }
      }
    }
    children(node).forEach(visit);
  };
  visit(root(xml));
  for (const colors of Object.values(out)) Object.freeze(colors);
  return Object.freeze(out);
}
const fillPaint = (node, palette) => {
  const pattern = modelChildren(node, 'patternFill', MAIN)[0];
  if (pattern?.getAttribute('patternType') !== 'solid') return null;
  const color = modelChildren(pattern, 'fgColor', MAIN)[0];
  if (!color || ['1', 'true'].includes(color.getAttribute('auto'))) return null;
  for (const key of ['theme', 'indexed']) {
    const raw = color.getAttribute(key), index = Number(raw), base = palette[key]?.[index];
    if (raw != null && /^\d+$/.test(raw) && base) return normalizeFontColor({ [key]: index, base, rgb: base, tint: Number(color.getAttribute('tint') || 0) }) || base;
  }
  const rgb = color.getAttribute('rgb');
  if (!/^(?:[a-f\d]{2})?[a-f\d]{6}$/i.test(rgb || '')) return null;
  const tint = Number(color.getAttribute('tint') || 0), base = rgb.slice(-6).toLowerCase();
  return `#${Number.isFinite(tint) && tint >= -1 && tint <= 1 && tint !== 0 ? tintRgb(base, tint) : base}`;
};

// Compare XML by expanded names, preserving child order and extension content.
// Resource equality never merges distinct keys: what counts is the relationship
// with Normal's fill, even for two byte-identical no-fill records.
const shape = node => node.nodeType === 1 ? [node.namespaceURI, node.localName,
  Array.from(node.attributes).filter(a => a.namespaceURI !== XMLNS)
    .map(a => [a.namespaceURI || '', a.localName, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  Array.from(node.childNodes).filter(n => n.nodeType === 1 || (n.nodeType === 3 || n.nodeType === 4) && n.data.trim()).map(shape)]
  : ['text', node.data];
export const nativeFillXmlIdentity = xml => JSON.stringify(shape(root(xml)));

/** Immutable, portable resource value. Styles share the value in memory;
 * drafts and clipboard snapshots intern definitions once by key. */
export function normalizeNativeFill(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail();
  if (values.has(value)) return value;
  if (typeof value.key !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(value.key)) fail();
  const node = root(value.xml), xml = standaloneModelXml(node), palette = nativeFillPalette(xml, value.palette);
  const paint = fillPaint(node, palette);
  if (value.paint != null && !sameFillColor(normalizeFillColor(value.paint), paint)) fail();
  const out = Object.freeze({ key: value.key, xml, palette, paint });
  values.add(out); projections.set(out, Object.freeze({ key: out.key, xml: JSON.stringify(shape(node)), palette: out.palette }));
  return out;
}
export const nativeFillProjection = value => value == null ? null : projections.get(normalizeNativeFill(value));
export const nativeFillMatchesPaint = (value, paint) => sameFillColor(value.paint ?? null, paint === 'transparent' ? null : paint ?? null);
/** Table/PivotTable looks compare complete fill bindings with named Normal.
 * No fill clears a colored Normal; a duplicate No fill also remains direct. */
export function nativeFillOverridesNormal(style, normalFill = null) {
  if (style?.nativeFill) return style.nativeFill.key !== normalFill?.key || !nativeFillMatchesPaint(style.nativeFill, style.bg);
  if (style?.bg != null) return true;
  return !!normalFill && (!!style && (Object.hasOwn(style, 'nativeFill') || Object.hasOwn(style, 'bg')));
}
export function nativeFillPaintKind(value) {
  const node = root(normalizeNativeFill(value).xml), parts = children(node);
  if (Array.from(node.attributes).some(a => a.namespaceURI !== XMLNS)) return 'other';
  if (!parts.length) return 'none';
  if (parts.length !== 1 || parts[0].namespaceURI !== MAIN) return 'other';
  if (parts[0].localName === 'gradientFill') return 'gradient';
  if (parts[0].localName !== 'patternFill') return 'other';
  return parts[0].getAttribute('patternType') || 'none';
}

/** Rebase theme/indexed colors only when a copied resource's source palette
 * differs. Pattern geometry, gradient stops, reserved/automatic colors and
 * extensions retain their native representation. */
export function nativeFillXml(value, palette) {
  const fill = normalizeNativeFill(value), node = root(fill.xml);
  const visit = n => {
    if (n.namespaceURI === MAIN && ['fgColor', 'bgColor', 'color'].includes(n.localName)
      && !['1', 'true'].includes(n.getAttribute('auto'))) {
      for (const key of ['theme', 'indexed']) {
        const raw = n.getAttribute(key), index = Number(raw);
        if (raw == null || !/^\d+$/.test(raw)) continue;
        const base = fill.palette[key]?.[index];
        if (!base) continue;
        const color = normalizeFontColor({ [key]: index, base, rgb: base, tint: Number(n.getAttribute('tint') || 0) });
        const rebased = fontColorInPalette(color, palette);
        if (typeof rebased === 'string') {
          for (const attribute of ['theme', 'indexed', 'tint']) n.removeAttribute(attribute);
          n.setAttribute('rgb', `FF${rebased.slice(1).toUpperCase()}`);
        }
        break;
      }
    }
    for (const child of children(n)) visit(child);
  };
  visit(node);
  return standaloneModelXml(node);
}

export function readNativeFillResources(records, namespaces, palette, paints, normalIndex, baseline = null, definitions = null) {
  if (!records.length) return { fills: [], normal: null };
  if (namespaces.length > MAX_XML) fail();
  if (!/\bxmlns\s*=/.test(namespaces)) namespaces += ` xmlns="${MAIN}"`;
  const namespace = crypto.randomUUID(), fills = records.map((xml, index) => {
    if (xml.length > MAX_XML) fail();
    const node = modelChildren(parseModelXml(`<styles ${namespaces}>${xml}</styles>`), 'fill', MAIN)[0];
    if (!node) fail();
    const standalone = standaloneModelXml(node), previous = baseline?.records?.[index];
    const unchanged = previous && typeof previous.xml === 'string' && previous.xml.length <= MAX_XML
      && nativeFillXmlIdentity(previous.xml) === JSON.stringify(shape(node));
    // A writer-created fill has no imported resource binding. Its unchanged
    // native projection must not turn sparse app styles into direct overrides.
    const newNormalBinding = index === normalIndex && Number.isInteger(baseline?.normalIndex) && baseline.normalIndex !== normalIndex;
    if (unchanged && previous.key == null && !newNormalBinding) return null;
    const pattern = children(node);
    const defaultNone = index === 0 && normalIndex === 0 && !Array.from(node.attributes).some(a => a.namespaceURI !== XMLNS)
      && (!pattern.length || pattern.length === 1 && pattern[0].namespaceURI === MAIN && pattern[0].localName === 'patternFill'
        && ['none', ''].includes(pattern[0].getAttribute('patternType') || '') && !children(pattern[0]).length
        && !Array.from(pattern[0].attributes).some(a => a.namespaceURI !== XMLNS && a.name !== 'patternType'));
    // The canonical built-in no-fill record already shares the writer's
    // Normal fill zero. A duplicate no-fill record still gets its own key.
    if (defaultNone) return null;
    const samePalette = unchanged && JSON.stringify(previous.palette) === JSON.stringify(nativeFillPalette(standalone, palette));
    const fill = normalizeNativeFill({ key: samePalette && typeof previous.key === 'string' ? previous.key : `${namespace}:${index}`,
      xml: standalone, palette, paint: paints[index] });
    const saved = definitions?.[fill.key];
    return saved && JSON.stringify(nativeFillProjection(saved)) === JSON.stringify(nativeFillProjection(fill)) ? normalizeNativeFill(saved) : fill;
  });
  return { fills, normal: fills[normalIndex] || null };
}

// Copy only dictionaries and records whose binding changes. Ordinary app
// workbooks pay one scan, without another copy of every cell/style snapshot.
const mapRecords = (records, map) => {
  let out = records;
  for (const [key, value] of Object.entries(records)) {
    const next = map(value);
    if (next === value) continue;
    if (out === records) out = { ...records };
    out[key] = next;
  }
  return out;
};
const mapSheetStyles = (sheet, map) => {
  let out = sheet;
  const replace = (key, next) => {
    if (next === sheet[key]) return;
    if (out === sheet) out = { ...sheet };
    out[key] = next;
  };
  if (sheet.cells) replace('cells', mapRecords(sheet.cells, cell => {
    if (!cell?.s) return cell;
    const s = map(cell.s); return s === cell.s ? cell : { ...cell, s };
  }));
  for (const key of ['styles', 'colStyles', 'rowStyles']) if (sheet[key]) replace(key, mapRecords(sheet[key], map));
  if (sheet.nativeRowStyleBase) replace('nativeRowStyleBase', map(sheet.nativeRowStyleBase));
  if (sheet.styleResets) {
    const records = sheet.styleResets.map(record => {
      if (!record.values) return record;
      const values = map(record.values); return values === record.values ? record : { ...record, values };
    });
    if (records.some((record, i) => record !== sheet.styleResets[i])) replace('styleResets', records);
  }
  return out;
};
const mapState = (state, map) => ({ ...state, ...(state.sheets ? { sheets: Array.isArray(state.sheets)
  ? state.sheets.map(sheet => mapSheetStyles(sheet, map))
  : Object.fromEntries(Object.entries(state.sheets).map(([name, sheet]) => [name, mapSheetStyles(sheet, map)])) } : {}) });

export function nativeFillEncoder() {
  const records = Object.create(null);
  const ref = value => {
    if (value == null) return null;
    const fill = normalizeNativeFill(value);
    if (records[fill.key] && records[fill.key] !== fill && JSON.stringify(records[fill.key]) !== JSON.stringify(fill)) fail();
    records[fill.key] = fill;
    return fill.key;
  };
  const style = style => style?.nativeFill ? { ...style, nativeFill: ref(style.nativeFill) } : style;
  return { records, ref, style };
}
export function packNativeFillState(state) {
  const encoder = nativeFillEncoder(), out = mapState(state, encoder.style);
  if (state.nativeDefaultCellFormat) out.nativeDefaultCellFormat = { ...state.nativeDefaultCellFormat, style: encoder.style(state.nativeDefaultCellFormat.style) };
  if (state.nativeNormalFill) out.nativeNormalFill = encoder.ref(state.nativeNormalFill);
  if (Object.keys(encoder.records).length) out.nativeFillRecords = encoder.records;
  return out;
}
export function nativeFillDecoder(records = {}) {
  if (!records || typeof records !== 'object' || Array.isArray(records) || Object.keys(records).length > 100000) fail();
  const fills = new Map(Object.entries(records).map(([key, value]) => {
    const fill = normalizeNativeFill(value); if (fill.key !== key) fail(); return [key, fill];
  }));
  const ref = value => {
    if (value == null) return null;
    if (typeof value !== 'string') return normalizeNativeFill(value);
    if (!fills.has(value)) fail();
    return fills.get(value);
  };
  const style = style => style?.nativeFill ? { ...style, nativeFill: ref(style.nativeFill) } : style;
  return { ref, style, records: Object.fromEntries(fills) };
}
export function unpackNativeFillState(state) {
  if (!state.nativeFillRecords) return state;
  const decoder = nativeFillDecoder(state.nativeFillRecords), out = mapState(state, decoder.style);
  if (state.nativeDefaultCellFormat) out.nativeDefaultCellFormat = { ...state.nativeDefaultCellFormat, style: decoder.style(state.nativeDefaultCellFormat.style) };
  out.nativeFillRecords = decoder.records;
  if (state.nativeNormalFill) out.nativeNormalFill = decoder.ref(state.nativeNormalFill);
  return out;
}

/** Choosing a color replaces its native resource binding, including a
 * same-color choice. Invalid reference input does not clear a valid binding. */
export function nativeFillPatch(patch) {
  if (!patch || !Object.hasOwn(patch, 'bg') || Object.hasOwn(patch, 'nativeFill')) return patch;
  if (patch.bg != null && typeof patch.bg === 'object' && !normalizeFillColor(patch.bg)) return patch;
  return { ...patch, nativeFill: null };
}
