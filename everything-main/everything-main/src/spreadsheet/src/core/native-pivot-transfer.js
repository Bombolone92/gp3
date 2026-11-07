import { modelConnectionId } from './data-model-bindings.js';
import { normalizeNativePivots, pivotChartQualifier } from './native-pivots.js';
import { parseModelXml, modelChildren, standaloneModelXml } from './data-model-metadata.js';
import { decodeXlsxString, encodeXlsxAttribute } from './xlsx-string.js';
import { sheetKey } from './refs.js';
import { effectiveColorPalette } from './font-color.js';
import { effectiveFontTheme, resolveThemeFont } from './font-theme.js';
import { xlsxColor } from './xlsx-styles.js';
import { copyPivotRuleBindings } from './native-pivot-rule-bindings.js';
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const identity = p => JSON.stringify([p.owner, sheetKey(decodeXlsxString(p.name))]);
const all = root => [root, ...Array.from(root.getElementsByTagName('*'))];
const child = (node, name, ns = MAIN) => modelChildren(node, name, ns)[0];
const fail = reason => { throw new Error(`Cannot transfer native pivots: ${reason}`); };
function renewIdentity(root) {
  for (const attr of Array.from(root.attributes)) if (attr.localName === 'uid' && /^http:\/\/schemas.microsoft.com\/office\/spreadsheetml\/\d+\/revision\d*$/.test(attr.namespaceURI || '')) {
    root.setAttributeNS(attr.namespaceURI, attr.name, `{${crypto.randomUUID().toUpperCase()}}`);
  }
}
function allocator(values, start = 1) {
  const used = new Set(values); let next = start;
  return () => { while (used.has(next)) next++; if (next > 4294967295) fail('identity limit'); used.add(next); return next++; };
}
function names(values, max = 32767) {
  const used = new Set(values.map(sheetKey));
  return value => {
    let name = value;
    for (let n = 2; used.has(sheetKey(name)); n++) {
      const suffix = `_${n}`; name = value.slice(0, max - suffix.length).replace(/[\uD800-\uDBFF]$/, '') + suffix;
    }
    used.add(sheetKey(name)); return name;
  };
}

/** Prepare a whole-workbook native graph for import. Only the unattached incoming
 * sheets are modified. The caller installs the result in its structural edit. */
export function transferNativePivots(destination, source, incoming, tableRenames, modelImport = null) {
  if (!source.nativePivots) return destination.nativePivots;
  if (source.dataModel && !modelImport) fail('missing data-model dependency transfer');
  const original = source.nativePivots;
  const base = destination.nativePivots || { version: 1, caches: [], tables: [], dxfs: [], styles: [], formats: {}, connections: destination.dataModel?.connectionsXml || '' };
  const owners = new Map(source.sheets.map((sheet, i) => [sheet.id, incoming[i]]));
  const sheetNames = new Map(source.sheets.map((sheet, i) => [sheetKey(sheet.name), incoming[i].name]));
  const tableNames = new Map(tableRenames.map(([from, to]) => [sheetKey(from), to]));
  const cacheRoots = original.caches.map(c => parseModelXml(c.xml));
  const reportRoots = original.tables.map(p => parseModelXml(p.xml));
  const styleRoots = original.styles.map(s => parseModelXml(s.xml));
  const dxfIndexes = new Map(), dxfRoots = [];
  const collectDxfs = root => {
    for (const node of all(root)) if (node.hasAttribute('dxfId')) {
      const id = Number(node.getAttribute('dxfId'));
      if (!Number.isInteger(id) || id < 0 || id >= original.dxfs.length) fail('missing differential style');
      if (!dxfIndexes.has(id)) {
        dxfIndexes.set(id, base.dxfs.length + dxfRoots.length);
        dxfRoots.push(parseModelXml(original.dxfs[id]));
      }
    }
  };
  for (const root of [...cacheRoots, ...reportRoots, ...styleRoots]) collectDxfs(root);
  for (let i = 0; i < dxfRoots.length; i++) collectDxfs(dxfRoots[i]);
  const roots = [...cacheRoots, ...reportRoots, ...dxfRoots, ...styleRoots];
  for (const root of [...cacheRoots, ...reportRoots, ...styleRoots]) renewIdentity(root);
  const baseRoots = [...base.caches, ...base.tables, ...base.styles].map(item => parseModelXml(item.xml));
  for (const xml of base.dxfs) baseRoots.push(parseModelXml(xml));
  const referencedFormats = roots => roots.flatMap(root => all(root).filter(n => n.hasAttribute('numFmtId')).map(n => Number(n.getAttribute('numFmtId'))));
  const formatId = allocator([...Object.keys(base.formats).map(Number), ...referencedFormats(baseRoots), ...referencedFormats(roots)], 164);
  const formats = { ...base.formats }, codes = new Map(Object.entries(formats).map(([id, code]) => [code, Number(id)]));
  const byFormat = new Map();
  const addCode = code => { if (!codes.has(code)) { const id = formatId(); codes.set(code, id); formats[id] = code; } return codes.get(code); };
  for (const [id, code] of Object.entries(original.formats)) byFormat.set(Number(id), addCode(code));
  const palette = effectiveColorPalette(source.colorPalette), targetPalette = effectiveColorPalette(destination.colorPalette);
  const themes = { themeElements: { clrScheme: palette.theme.map(rgb => ({ rgb: rgb?.slice(1) })) }, indexedColors: palette.indexed.map(rgb => rgb?.slice(1)) };
  const samePalette = JSON.stringify(palette) === JSON.stringify(targetPalette);
  const sameFonts = JSON.stringify(effectiveFontTheme(source.fontTheme)) === JSON.stringify(effectiveFontTheme(destination.fontTheme));
  for (const root of roots) for (const node of all(root)) {
    if (node.hasAttribute('numFmtId')) {
      const old = Number(node.getAttribute('numFmtId'));
      const next = node.hasAttribute('formatCode') ? addCode(decodeXlsxString(node.getAttribute('formatCode'))) : byFormat.get(old);
      if (next != null) node.setAttribute('numFmtId', String(next));
      else if (old === 0 && Object.hasOwn(base.formats, old)) node.setAttribute('numFmtId', String(addCode('General')));
      else if (old !== 0 && Object.hasOwn(base.formats, old)) fail('unresolved source number format');
    }
    if (node.hasAttribute('dxfId')) {
      const id = Number(node.getAttribute('dxfId'));
      if (!dxfIndexes.has(id)) fail('missing differential style');
      node.setAttribute('dxfId', String(dxfIndexes.get(id)));
    }
    if (!samePalette && node.namespaceURI === MAIN && (node.hasAttribute('theme') || node.hasAttribute('indexed'))) {
      if (['64', '65'].includes(node.getAttribute('indexed')) || ['1', 'true'].includes(node.getAttribute('auto'))) continue;
      const color = xlsxColor(standaloneModelXml(node), themes);
      if (!color) fail('unresolved source color');
      for (const attr of ['theme', 'indexed', 'tint']) node.removeAttribute(attr);
      node.setAttribute('rgb', `FF${color.slice(1).toUpperCase()}`);
    }
    if (!sameFonts && node.namespaceURI === MAIN && node.localName === 'scheme' && node.getAttribute('val') !== 'none') {
      let name = child(node.parentNode, 'name');
      const face = resolveThemeFont(name ? decodeXlsxString(name.getAttribute('val') || '') : null, node.getAttribute('val'), effectiveFontTheme(source.fontTheme));
      if (!face) fail('unresolved source font scheme');
      if (!name) {
        name = node.ownerDocument.createElementNS(MAIN, node.prefix ? `${node.prefix}:name` : 'name');
        node.parentNode.insertBefore(name, node);
      }
      name.setAttribute('val', encodeXlsxAttribute(face));
      node.setAttribute('val', 'none');
    }
  }
  const styleName = names(base.styles.map(s => decodeXlsxString(s.name))), styles = [...base.styles], styleNames = new Map();
  original.styles.forEach((style, i) => {
    const name = encodeXlsxAttribute(styleName(decodeXlsxString(style.name)));
    styleNames.set(sheetKey(decodeXlsxString(style.name)), name); styleRoots[i].setAttribute('name', name);
    styles.push({ name, xml: standaloneModelXml(styleRoots[i]) });
  });
  const usedCacheIds = baseRoots.flatMap(root => Array.from(root.getElementsByTagNameNS(X14, 'pivotCacheDefinition')).map(n => Number(n.getAttribute('pivotCacheId'))));
  const cacheId = allocator(usedCacheIds), cacheKeys = new Map(), caches = [...base.caches];
  original.caches.forEach((cache, i) => {
    const root = cacheRoots[i], key = crypto.randomUUID(); cacheKeys.set(cache.key, key);
    for (const ext of Array.from(root.getElementsByTagNameNS(X14, 'pivotCacheDefinition'))) if (ext.hasAttribute('pivotCacheId')) ext.setAttribute('pivotCacheId', String(cacheId()));
    const cacheSource = child(root, 'cacheSource'), worksheet = child(cacheSource, 'worksheetSource');
    if (cacheSource?.getAttribute('type') !== 'worksheet') {
      const id = modelConnectionId(cacheSource?.getAttribute('connectionId') ?? '0');
      if (cacheSource?.getAttribute('type') !== 'external' || !modelImport?.connectionIds.has(id)) fail('external connection transfer is not implemented');
      cacheSource.setAttribute('connectionId', String(modelImport.connectionIds.get(id)));
    }
    if (worksheet?.hasAttributeNS(REL, 'id') && !cache.sourceWorkbook) fail('external worksheet dependency is unavailable');
    if (worksheet && cache.sourceWorkbook == null && !worksheet.hasAttributeNS(REL, 'id')) {
      const rawSheet = decodeXlsxString(worksheet.getAttribute('sheet')), rawName = decodeXlsxString(worksheet.getAttribute('name'));
      if (rawSheet && !sheetNames.has(sheetKey(rawSheet))) fail('missing source worksheet');
      if (rawName) {
        const defined = source.namedEntry(rawName, rawSheet || null);
        if (defined) {
          const existing = destination.namedEntry(rawName, defined.sheet ? sheetNames.get(sheetKey(defined.sheet)) : null);
          if (existing) fail('conflicting named pivot source');
          // The general sheet importer localizes conflicting globals for cell
          // formulas. Cache-source names need a workbook-level dependency graph;
          // they must not pick up those destination definitions indirectly.
          if (source.names.some(name => !name.sheet && destination.namedEntry(name.name, null))) fail('conflicting named pivot source dependencies');
        } else {
          if (!source.tableByName(rawName)) fail('missing named pivot source');
          if (tableNames.has(sheetKey(rawName))) worksheet.setAttribute('name', encodeXlsxAttribute(tableNames.get(sheetKey(rawName))));
        }
      }
      if (rawSheet && sheetNames.has(sheetKey(rawSheet))) worksheet.setAttribute('sheet', encodeXlsxAttribute(sheetNames.get(sheetKey(rawSheet))));
    }
    if (cache.sourceSheetId != null && !owners.has(cache.sourceSheetId)) fail('missing source worksheet');
    caches.push({ ...cache, key, sourceSheetId: cache.sourceSheetId == null ? null : owners.get(cache.sourceSheetId).id, xml: standaloneModelXml(root) });
  });
  // External connection parts require their own dependency/identity merge. Do not
  // attach a copied cache to a destination connection with the same numeric ID.
  if (original.connections && !modelImport) fail('external connection transfer is not implemented');
  const reportName = names(base.tables.map(p => decodeXlsxString(p.name))), reports = new Map(), tables = [...base.tables], rules = new Map();
  original.tables.forEach((report, i) => {
    const root = reportRoots[i], name = encodeXlsxAttribute(reportName(decodeXlsxString(report.name)));
    if (report.owner != null && !owners.has(report.owner)) fail('missing report worksheet');
    root.setAttribute('name', name);
    for (const style of Array.from(root.getElementsByTagNameNS(MAIN, 'pivotTableStyleInfo'))) {
      const next = styleNames.get(sheetKey(decodeXlsxString(style.getAttribute('name')))); if (next) style.setAttribute('name', next);
    }
    const copy = { ...report, name, cache: cacheKeys.get(report.cache), owner: report.owner == null ? null : owners.get(report.owner).id,
      ...(report.conditionalRules ? { conditionalRules: report.conditionalRules.map(rule => {
        if (!rules.has(rule.id)) rules.set(rule.id, [crypto.randomUUID()]);
        return { ...rule, id: rules.get(rule.id)[0] };
      }) } : {}), xml: standaloneModelXml(root) };
    reports.set(identity(report), copy); tables.push(copy);
  });
  const slicerName = names((base.slicers || []).map(s => s.name), 255), slicerNames = new Map();
  const slicers = (original.slicers || []).map(slicer => {
    const name = slicerName(slicer.name), root = parseModelXml(slicer.xml); slicerNames.set(sheetKey(slicer.name), name);
    root.setAttribute('name', encodeXlsxAttribute(name));
    renewIdentity(root);
    return { ...slicer, name, cache: cacheKeys.get(slicer.cache), xml: standaloneModelXml(root), connections: slicer.connections.map(ref => {
      const report = reports.get(identity(ref)); if (!report) fail('missing slicer report'); return { owner: report.owner, name: report.name };
    }) };
  });
  const result = normalizeNativePivots({ ...base, ...(modelImport ? { connections: modelImport.dataModel.connectionsXml } : {}), caches, tables, formats, styles, dxfs: [...base.dxfs, ...dxfRoots.map(standaloneModelXml)],
    ...((base.slicers || original.slicers) ? { slicers: [...(base.slicers || []), ...slicers] } : {}) });
  if (!result) fail('invalid or oversized merged metadata');
  // Apply only after every dependency has been validated.
  for (let i = 0; i < incoming.length; i++) {
    const sheet = incoming[i], originalSheet = source.sheets[i];
    sheet.rules = sheet.rules.map(rule => copyPivotRuleBindings(rule, rules));
    sheet.charts = sheet.charts.map((chart, j) => {
      if (chart.type === 'slicer' && chart.pivotCache != null) {
        const pivotCache = slicerNames.get(sheetKey(chart.pivotCache)); if (!pivotCache) fail('missing slicer cache');
        return { ...chart, pivotCache };
      }
      const old = originalSheet.charts[j]?.pivotSource;
      if (!old) return chart;
      for (const report of original.tables) {
        const owner = source.sheet(report.owner);
        let match = owner && !old.standalone ? pivotChartQualifier(old.name, owner.name, report.name) : null;
        if (old.standalone && report.owner == null) {
          const quoted = old.name.startsWith("'") && old.name.endsWith("'");
          const value = quoted ? old.name.slice(1, -1).replace(/''/g, "'") : old.name;
          const end = value.startsWith('[') ? value.lastIndexOf(']') : -1;
          if (sheetKey(value.slice(end + 1)) === sheetKey(report.name)) match = { quoted, prefix: value.slice(0, end + 1) };
        }
        if (!match) continue;
        const next = reports.get(identity(report)), text = old.standalone ? `${match.prefix}${next.name}` : `${match.prefix}${owners.get(report.owner).name}`;
        const qualifier = match.quoted ? "'" + text.replace(/'/g, "''") + "'" : text;
        return { ...chart, pivotSource: { ...chart.pivotSource, name: qualifier + (old.standalone ? '' : `!${next.name}`) } };
      }
      fail('missing PivotChart report');
    });
  }
  return result;
}
