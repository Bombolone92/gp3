import { readNativePivotSlicerState } from './native-pivot-slicer-state.js';
import { resolveNativePivotSlicers } from './native-pivot-slicer.js';
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { decodeXlsxString, encodeXlsxAttribute } from './xlsx-string.js';
import { sheetKey } from './refs.js';

const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const fail = reason => { throw new Error(`Invalid stored pivot slicer: ${reason}`); };
const identity = p => JSON.stringify([p.owner, sheetKey(decodeXlsxString(p.name))]);

/** Package tabIds/cacheIds are not workbook identities. Keep their native XML,
 * but bind caches and connected reports to stable model keys alongside it. */
export function normalizeNativePivotSlicers(value, pivots, text = null) {
  if (value == null) return undefined;
  let total = 0;
  text ||= (s, max = 16 * 1024 * 1024) => {
    if (typeof s !== 'string' || s.length > max || (total += s.length) > 256 * 1024 * 1024) fail('text limit'); return s;
  };
  if (!Array.isArray(value) || value.length > 65536) fail('cache count');
  const cacheKeys = new Set(pivots.caches.map(c => c.key)), reports = new Map(), names = new Set();
  for (const report of pivots.tables) {
    const key = identity(report);
    if (reports.has(key)) fail('ambiguous report');
    reports.set(key, report);
  }
  return value.map(raw => {
    const xml = text(raw.xml), state = readNativePivotSlicerState({ kind: 'pivot', xml }, { requireItems: false });
    const key = sheetKey(state.name);
    if (names.has(key)) fail('duplicate name'); names.add(key);
    const cache = text(raw.cache, 8192);
    if (!cacheKeys.has(cache)) fail('missing source cache');
    if (!Array.isArray(raw.connections) || raw.connections.length > 65536) fail('connections');
    const seen = new Set();
    const connections = raw.connections.map(ref => {
      const connection = { owner: ref.owner == null ? null : text(ref.owner, 8192), name: text(ref.name, 32767) };
      const key = identity(connection), report = reports.get(key);
      if (!report || report.cache !== cache || seen.has(key)) fail('missing, duplicate or mismatched report');
      seen.add(key); return { owner: report.owner, name: report.name };
    });
    return { kind: 'pivot', name: state.name, cache, connections, xml };
  });
}

/** Native parsing already resolved package references; translate sheet names
 * once, at import, rather than keeping package sheet numbers in the model. */
export function importNativePivotSlicerCaches(native, pivots, sheets) {
  // Data Model (OLAP) caches have no PivotCache to bind to; their views are not imported either.
  const caches = native?.caches.filter(c => c.kind === 'pivot' && c.pivot) || [];
  if (!caches.length) return pivots;
  if (!pivots) fail('missing native pivots');
  const slicers = caches.map(cache => {
    return { xml: cache.xml, cache: cache.pivot.cacheKey, connections: cache.pivot.reports.map(ref => {
      const owner = ref.sheet == null ? null : sheets.find(s => sheetKey(s.name) === sheetKey(ref.sheet))?.id;
      if (ref.sheet != null && owner == null) fail('missing report worksheet');
      const found = pivots.tables.filter(p => p.owner === owner && sheetKey(decodeXlsxString(p.name)) === sheetKey(ref.name));
      if (found.length !== 1) fail('missing or ambiguous report');
      return { owner, name: found[0].name };
    }) };
  });
  return { ...pivots, slicers: normalizeNativePivotSlicers(slicers, pivots) };
}

/** Follow a moved report, or remove a deleted connection. New copies do not
 * alter the original cache's declared report connections. */
export function mapNativePivotSlicerConnections(pivots, tables, replacements = new Map()) {
  if (!pivots.slicers) return {};
  const old = new Map(pivots.tables.map(p => [identity(p), p]));
  const current = new Map(tables.map(p => [identity(p), p]));
  return { slicers: pivots.slicers.map(slicer => ({ ...slicer, connections: slicer.connections.flatMap(ref => {
    const previous = old.get(identity(ref)), next = replacements.get(previous) || current.get(identity(ref));
    return next ? [{ owner: next.owner, name: next.name }] : [];
  }) })) };
}

/** A worksheet copy retains its reports' slicer connections, even when the
 * corresponding views live elsewhere. Views still share the same cache. */
export function duplicateNativePivotSlicerConnections(pivots, copies) {
  if (!pivots.slicers) return {};
  const copied = new Map([...copies].map(([source, copy]) => [identity(source), copy]));
  return { slicers: pivots.slicers.map(slicer => ({ ...slicer, connections: [
    ...slicer.connections.map(ref => ({ ...ref })),
    ...slicer.connections.flatMap(ref => {
      const copy = copied.get(identity(ref));
      return copy ? [{ owner: copy.owner, name: copy.name }] : [];
    }),
  ] })) };
}

/** Validate all caches together so source fields are decoded once per source,
 * not once per slicer. Only the small serialization records are copied. */
export function prepareNativePivotSlicerCaches(value, pivots, sheets) {
  const slicers = normalizeNativePivotSlicers(value, pivots);
  if (!slicers?.length) return [];
  const states = slicers.map(s => readNativePivotSlicerState(s, { requireItems: false }));
  const bindings = resolveNativePivotSlicers(states, pivots, sheets);
  const sheetIds = new Map(sheets.flatMap((s, i) => s.kind === 'chart' ? [] : [[s.id, i + 1]]));
  return slicers.map((slicer, i) => {
    const pivotCacheId = bindings.get(states[i]).slicerCacheId;
    if (pivotCacheId == null) fail('missing x14 source cache identity');
    const connections = slicer.connections.map(ref => {
      const tabId = ref.owner == null ? 0 : sheetIds.get(ref.owner);
      if (tabId == null) fail('missing report worksheet');
      return { ...ref, tabId };
    });
    return { ...slicer, pivotCacheId, connections };
  });
}

/** Serialize a validated preparation record. Rewrite only package identities;
 * selections, no-data flags, member order and
 * extensions remain native. Non-worksheet report tabId is ignored by Office. */
export function nativePivotSlicerCacheXml(slicer, name = slicer.name, uid = null) {
  const root = parseModelXml(slicer.xml);
  root.setAttribute('name', encodeXlsxAttribute(name));
  const revision = 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision10';
  if (uid != null && !root.hasAttributeNS(revision, 'uid')) {
    root.setAttributeNS(revision, 'xr10:uid', uid);
    const mc = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
    const ignorable = new Set((root.getAttributeNS(mc, 'Ignorable') || '').split(/\s+/).filter(Boolean));
    ignorable.add('xr10');
    root.setAttributeNS(mc, root.getAttributeNodeNS(mc, 'Ignorable')?.name || 'mc:Ignorable', [...ignorable].join(' '));
  }
  const data = modelChildren(root, 'data', X14)[0], tabular = modelChildren(data, 'tabular', X14)[0];
  tabular.setAttribute('pivotCacheId', String(slicer.pivotCacheId));
  const previous = modelChildren(root, 'pivotTables', X14)[0];
  if (previous) root.removeChild(previous);
  if (slicer.connections.length) {
    const list = root.ownerDocument.createElementNS(X14, 'x14:pivotTables');
    for (const ref of slicer.connections) {
      const item = root.ownerDocument.createElementNS(X14, 'x14:pivotTable');
      item.setAttribute('tabId', String(ref.tabId)); item.setAttribute('name', ref.name);
      list.appendChild(item);
    }
    root.insertBefore(list, data);
  }
  return standaloneModelXml(root);
}
