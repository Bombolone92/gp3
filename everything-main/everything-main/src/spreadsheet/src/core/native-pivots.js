import { clonedPivotRuleMap, copyPivotRuleBindings } from './native-pivot-rule-bindings.js';
import { normalizeNativePivotSlicers, mapNativePivotSlicerConnections, duplicateNativePivotSlicerConnections } from './native-pivot-slicer-storage.js';
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { parseRefText, refToText, sheetKey, MAX_ROW, MAX_COL } from './refs.js';
import { decodeXlsxString, encodeXlsxAttribute } from './xlsx-string.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/** Named worksheet sources can refer to a table or a defined name. Only the
 * former follows a table rename; external workbook sources keep their identity. */
export function renameNativePivotTableSource(pivots, from, to, isDefinedName = () => false) {
  if (!pivots) return pivots;
  let changed = false;
  const caches = pivots.caches.map(cache => {
    if (cache.sourceWorkbook != null) return cache;
    const root = parseModelXml(cache.xml);
    const source = modelChildren(modelChildren(root, 'cacheSource', MAIN)[0], 'worksheetSource', MAIN)[0];
    if (!source || source.hasAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')) return cache;
    const name = decodeXlsxString(source.getAttribute('name'));
    if (!name || sheetKey(name) !== sheetKey(from) || isDefinedName(name, decodeXlsxString(source.getAttribute('sheet')) || null)) return cache;
    source.setAttribute('name', encodeXlsxAttribute(to)); changed = true;
    return { ...cache, xml: standaloneModelXml(root) };
  });
  return changed ? { ...pivots, caches } : pivots;
}
// Early version-1 drafts stored ranges only in the native XML. Recover these
// once at the persistence boundary; an explicit edited reference stays authoritative.
function storedRange(xml, rootName, path) {
  let node = parseModelXml(xml);
  if (node.namespaceURI !== MAIN || node.localName !== rootName) throw new Error('Invalid pivot range metadata');
  for (const name of path) {
    const matches = modelChildren(node, name, MAIN);
    if (matches.length > 1) throw new Error('Ambiguous pivot range metadata');
    node = matches[0];
    if (!node) return '';
  }
  return node.getAttribute('ref') || '';
}

// Native pivot definitions are workbook objects. Owner sheet IDs survive
// renames; a null owner denotes an Office non-worksheet (chart-only) pivot.
export function normalizeNativePivots(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.caches) || !Array.isArray(value.tables)
      || value.caches.length > 65536 || value.tables.length > 65536) return null;
  let total = 0;
  const text = (v, limit = 16 * 1024 * 1024) => {
    if (typeof v !== 'string' || v.length > limit || (total += v.length) > 256 * 1024 * 1024) throw new Error('Invalid pivot storage');
    return v;
  };
  try {
    const caches = value.caches.map(c => {
      if (c.sourceWorkbook != null && (c.sourceSheetId != null || typeof c.sourceWorkbook !== 'string' || !c.sourceWorkbook.trim())) throw new Error('Invalid external pivot source');
      return { key: text(c.key, 8192), xml: text(c.xml), records: text(c.records || '', 128 * 1024 * 1024),
      scope: ['main', 'x14', 'x15'].includes(c.scope) ? c.scope : 'main',
      ...(c.sourceWorkbook == null ? {} : { sourceWorkbook: text(c.sourceWorkbook, 32767) }),
      sourceSheetId: c.sourceSheetId == null ? null : text(c.sourceSheetId, 8192),
      sourceRef: text(c.sourceRef || (c.sourceSheetId == null ? '' : storedRange(c.xml, 'pivotCacheDefinition', ['cacheSource', 'worksheetSource'])), 8192) };
    });
    const keys = new Set(caches.map(c => c.key));
    if (keys.size !== caches.length) return null;
    const tables = value.tables.map(p => {
      if (!keys.has(p.cache)) throw new Error('Missing pivot cache');
      if (p.conditionalRules != null && (!Array.isArray(p.conditionalRules) || p.conditionalRules.length > 65536)) throw new Error('Invalid pivot conditional bindings');
      const priorities = new Set();
      return { name: text(p.name, 32767), cache: p.cache, owner: p.owner == null ? null : text(p.owner, 8192), ref: text(p.ref || storedRange(p.xml, 'pivotTableDefinition', ['location']), 8192), xml: text(p.xml), ...(p.conditionalRules == null ? {} : { conditionalRules: p.conditionalRules.map(item => {
        if (!Number.isInteger(item.priority) || item.priority < 1 || item.priority > 4294967295 || priorities.has(item.priority) || !item.id) throw new Error('Invalid pivot conditional priority');
        priorities.add(item.priority);
        return { priority: item.priority, id: text(item.id, 8192) };
      }) }) };
    });
    const dxfs = (value.dxfs || []).map(s => text(s));
    const styles = (value.styles || []).map(s => ({ name: text(s.name, 32767), xml: text(s.xml) }));
    const formats = Object.fromEntries(Object.entries(value.formats || {}).filter(([id, code]) => /^\d+$/.test(id) && typeof code === 'string').map(([id, code]) => [id, text(code, 32767)]));
    const slicers = normalizeNativePivotSlicers(value.slicers, { caches, tables }, text);
    return { version: 1, caches, tables, dxfs, styles, formats, connections: text(value.connections || ''), ...(slicers == null ? {} : { slicers }) };
  } catch { return null; }
}

/** Report cells form one indivisible layout. Whole-line edits may move or
 * remove it, but must not split it or push it outside the worksheet. */
export function pivotLineConflict(pivots, sheetId, axis, at, count, lines = null) {
  const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2';
  const limit = axis === 'row' ? MAX_ROW : MAX_COL;
  for (const pivot of pivots?.tables || []) {
    if (pivot.owner !== sheetId) continue;
    const range = parseRefText(pivot.ref || '');
    if (!range) continue;
    if (lines) {
      const removed = lines.before(range[hi] + 1) - lines.before(range[lo]);
      if (removed && removed !== range[hi] - range[lo] + 1) return { pivot, range, reason: 'partial' };
    } else {
      if (range[lo] < at && at <= range[hi]) return { pivot, range, reason: 'partial' };
      if (at <= range[lo] && range[hi] + count > limit) return { pivot, range, reason: 'bounds' };
    }
  }
  return null;
}

/** Immutable updates let structural history retain native definitions cheaply.
 * The cached data stays unchanged until a separate refresh operation. */
export function mapNativePivotRanges(pivots, sheetId, map) {
  if (!pivots) return pivots;
  const rewrite = ref => { const parsed = parseRefText(ref || ''); if (!parsed) return ref; const next = map(parsed); return next ? refToText(next) : '#REF!'; };
  const tables = pivots.tables.flatMap(p => {
    if (p.owner !== sheetId || !p.ref) return [p];
    const ref = rewrite(p.ref);
    return ref === '#REF!' ? [] : [{ ...p, ref }];
  });
  return { ...pivots, ...mapNativePivotSlicerConnections(pivots, tables),
    caches: pivots.caches.map(c => c.sourceSheetId === sheetId && c.sourceRef ? { ...c, sourceRef: rewrite(c.sourceRef) } : c),
    tables,
  };
}

/** Cell insertion/deletion shifts a band, so a report may only follow when
 * the entire perpendicular extent is inside that band. */
export function pivotBlockConflict(pivots, sheetId, block, axis, remove) {
  const lo = axis === 'row' ? 'r1' : 'c1', hi = axis === 'row' ? 'r2' : 'c2';
  const otherLo = axis === 'row' ? 'c1' : 'r1', otherHi = axis === 'row' ? 'c2' : 'r2';
  const at = block[lo], count = block[hi] - at + 1, limit = axis === 'row' ? MAX_ROW : MAX_COL;
  for (const pivot of pivots?.tables || []) {
    if (pivot.owner !== sheetId) continue;
    const range = parseRefText(pivot.ref || '');
    if (!range || range[hi] < at || range[otherHi] < block[otherLo] || range[otherLo] > block[otherHi]) continue;
    const inside = range[otherLo] >= block[otherLo] && range[otherHi] <= block[otherHi];
    const split = !inside || (!remove && range[lo] < at)
      || (remove && range[lo] < at + count && !(at <= range[lo] && at + count > range[hi]));
    if (split) return { pivot, range, reason: 'partial' };
    if (!remove && range[hi] + count > limit) return { pivot, range, reason: 'bounds' };
  }
  return null;
}

const containsRange = (outer, inner) => outer.r1 <= inner.r1 && outer.c1 <= inner.c1 && outer.r2 >= inner.r2 && outer.c2 >= inner.c2;
const intersectsRange = (a, b) => a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;

/** A cell move carries complete native reports, never individual report cells.
 * The destination must not overwrite another report, even if it covers it whole. */
export function pivotMoveConflict(pivots, sourceId, src, targetId, dst) {
  for (const pivot of pivots?.tables || []) {
    const range = parseRefText(pivot.ref || '');
    if (!range) continue;
    const moving = pivot.owner === sourceId && containsRange(src, range);
    if (moving && (src.r2 - src.r1 !== dst.r2 - dst.r1 || src.c2 - src.c1 !== dst.c2 - dst.c1)) return { pivot, range, reason: 'move-partial' };
    if (moving && sourceId !== targetId && pivots.tables.some(p => p.owner === targetId && sheetKey(p.name) === sheetKey(pivot.name))) return { pivot, range, reason: 'name' };
    if (pivot.owner === sourceId && intersectsRange(src, range) && !moving) return { pivot, range, reason: 'move-partial' };
    if (pivot.owner === targetId && !moving && intersectsRange(dst, range)) return { pivot, range, reason: 'overlap' };
  }
  return null;
}

/** Move both report ownership and explicit worksheet cache-source references.
 * Cache data and definitions are shared unchanged until refresh. */
export function moveNativePivotRanges(pivots, sourceId, src, targetId, dst) {
  if (!pivots) return pivots;
  const dr = dst.r1 - src.r1, dc = dst.c1 - src.c1;
  const move = (ref, owner) => {
    const range = owner === sourceId && parseRefText(ref || '');
    return range && containsRange(src, range) ? refToText({ ...range, r1: range.r1 + dr, r2: range.r2 + dr, c1: range.c1 + dc, c2: range.c2 + dc }) : null;
  };
  let changed = false;
  const tables = pivots.tables.map(p => {
    const ref = move(p.ref, p.owner);
    if (!ref) return p;
    changed = true; return { ...p, owner: targetId, ref };
  });
  const caches = pivots.caches.map(c => {
    const ref = move(c.sourceRef, c.sourceSheetId);
    if (!ref) return c;
    changed = true; return { ...c, sourceSheetId: targetId, sourceRef: ref };
  });
  return changed ? { ...pivots, tables, caches,
    ...mapNativePivotSlicerConnections(pivots, tables, new Map(pivots.tables.map((p, i) => [p, tables[i]]))) } : pivots;
}

/** Reports touched by clearing visible contents. Skipped rows cannot be
 * deleted out from under a report, even when the bounding rectangle contains it. */
export function pivotClearPlan(pivots, sheetId, area, skipRow = null) {
  const removed = [];
  for (const pivot of pivots?.tables || []) {
    if (pivot.owner !== sheetId) continue;
    const range = parseRefText(pivot.ref || '');
    if (!range || !intersectsRange(area, range)) continue;
    let selected = !skipRow, skipped = false;
    for (let r = Math.max(area.r1, range.r1); skipRow && r <= Math.min(area.r2, range.r2); r++) {
      if (skipRow?.(r)) skipped = true; else selected = true;
      if (selected && skipped) break;
    }
    if (!selected) continue;
    if (skipped || !containsRange(area, range)) return { removed: [], conflict: { pivot, range, reason: 'clear-partial' } };
    removed.push(pivot);
  }
  return { removed, conflict: null };
}

/** Resolve the worksheet qualifier of a native PivotChart identity. */
export function pivotChartQualifier(name, sheetName, pivotName) {
  if (typeof name !== 'string') return null;
  // Match identities after normalization, but retain their original spelling.
  // Count delimiters from the right: sheet/workbook names can contain ! too,
  // and scanning and normalizing every candidate suffix would be quadratic.
  let bang = name.length;
  const separators = String(pivotName).split('!').length;
  for (let i = 0; i < separators; i++) {
    bang = name.lastIndexOf('!', bang - 1);
    if (bang < 0) return null;
  }
  if (sheetKey(name.slice(bang + 1)) !== sheetKey(pivotName)) return null;
  const qualifier = name.slice(0, bang), quoted = qualifier.startsWith("'") && qualifier.endsWith("'");
  const decoded = quoted ? qualifier.slice(1, -1).replace(/''/g, "'") : qualifier;
  const end = decoded.startsWith('[') ? decoded.lastIndexOf(']') : -1;
  if (decoded.startsWith('[') && end < 0) return null;
  const prefix = end < 0 ? '' : decoded.slice(0, end + 1);
  return sheetKey(decoded.slice(end + 1)) === sheetKey(sheetName) ? { prefix, quoted, suffix: name.slice(bang) } : null;
}

/** A report keeps its identity when its worksheet moves or is renamed. */
export function renamePivotChartSheet(chart, pivots, from, to) {
  if (!chart.pivotSource || chart.pivotSource.standalone) return chart;
  for (const pivot of pivots) {
    const match = pivotChartQualifier(chart.pivotSource.name, from, pivot.name);
    if (!match) continue;
    const target = `${match.prefix}${to}`;
    const qualifier = match.quoted ? "'" + target.replace(/'/g, "''") + "'" : target;
    return { ...chart, pivotSource: { ...chart.pivotSource, name: `${qualifier}${match.suffix}` } };
  }
  return chart;
}


/** Duplicate report layouts within one workbook while sharing their caches. */
export function duplicateNativePivots(pivots, source, target, charts) {
  if (!pivots) return { pivots, charts };
  const standaloneMatch = (chart, pivot) => {
    if (!chart.pivotSource?.standalone || pivot.owner != null) return null;
    const name = chart.pivotSource.name, quoted = name.startsWith("'") && name.endsWith("'");
    const decoded = quoted ? name.slice(1, -1).replace(/''/g, "'") : name;
    const end = decoded.startsWith('[') ? decoded.lastIndexOf(']') : -1;
    if (decoded.startsWith('[') && end < 0 || sheetKey(decoded.slice(end + 1)) !== sheetKey(pivot.name)) return null;
    return { prefix: decoded.slice(0, end + 1), quoted };
  };
  const selected = new Set(pivots.tables.filter(p => p.owner === source.id));
  for (const chart of charts) if (chart.pivotSource?.standalone) {
    const matches = pivots.tables.filter(p => standaloneMatch(chart, p));
    if (matches.length > 1) throw new Error('Ambiguous standalone PivotChart source');
    if (matches.length) selected.add(matches[0]);
  }
  if (!selected.size) return { pivots, charts };
  const copies = cloneNativePivotReports(pivots, [...selected].map(pivot => ({ pivot, owner: pivot.owner == null ? null : target.id, ref: pivot.ref })));
  const nextCharts = charts.map(chart => {
    if (!chart.pivotSource) return chart;
    for (const [pivot, copy] of copies) {
      const match = chart.pivotSource.standalone ? standaloneMatch(chart, pivot)
        : pivot.owner === source.id && pivotChartQualifier(chart.pivotSource.name, source.name, pivot.name);
      if (!match) continue;
      const text = chart.pivotSource.standalone ? `${match.prefix}${copy.name}` : `${match.prefix}${target.name}`;
      const quoted = match.quoted ? "'" + text.replace(/'/g, "''") + "'" : text;
      return { ...chart, pivotSource: { ...chart.pivotSource, name: quoted + (chart.pivotSource.standalone ? '' : `!${copy.name}`) } };
    }
    return chart;
  });
  const next = { ...pivots, tables: [...pivots.tables, ...copies.values()], ...duplicateNativePivotSlicerConnections(pivots, copies) };
  // Reject before the sheet is installed if the copy could not be persisted.
  if (!normalizeNativePivots(next)) throw new Error('Copied native pivots exceed storage limits');
  if (nextCharts.some(c => c.pivotSource?.name.length > 32767)) throw new Error('Copied PivotChart identity exceeds storage limit');
  const ruleMap = clonedPivotRuleMap(copies);
  target.rules = target.rules.map(rule => copyPivotRuleBindings(rule, ruleMap));
  return { pivots: next, charts: nextCharts };
}

/** Clone report identities independently of their worksheet/cell-copy transport. */
export function cloneNativePivotReports(pivots, reports) {
  if (pivots.tables.length + reports.length > 65536) throw new Error('Native PivotTable count limit exceeded');
  const names = new Set(pivots.tables.map(p => sheetKey(p.name))), copies = new Map(), candidates = new Map();
  for (const { pivot, owner, ref } of reports) {
    const key = sheetKey(pivot.name);
    let name, index = candidates.get(key) || 2;
    do { const suffix = `_${index++}`; name = pivot.name.slice(0, 32767 - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix; } while (names.has(sheetKey(name)));
    candidates.set(key, index);
    names.add(sheetKey(name));
    const root = parseModelXml(pivot.xml);
    if (root.namespaceURI !== MAIN || root.localName !== 'pivotTableDefinition') throw new Error('Invalid native pivot definition');
    root.setAttribute('name', name);
    const revision = 'http://schemas.microsoft.com/office/spreadsheetml/2014/revision';
    if (root.hasAttributeNS(revision, 'uid')) root.setAttributeNS(revision, root.getAttributeNodeNS(revision, 'uid').name, `{${crypto.randomUUID().toUpperCase()}}`);
    copies.set(pivot, { ...pivot, name, owner, ref, ...(pivot.conditionalRules ? { conditionalRules: pivot.conditionalRules.map(item => ({ ...item, id: crypto.randomUUID() })) } : {}), xml: standaloneModelXml(root) });
  }
  return copies;
}
