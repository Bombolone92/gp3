import { encodeXlsxAttribute } from './xlsx-string.js';
import { slicerTarget } from './slicer.js';
import { appendSlicerStyles } from './xlsx-export-slicer-styles.js';
import { xmlTag as tag } from './xlsx-export-styles.js';
import { prepareNativePivotSlicerCaches, nativePivotSlicerCacheXml } from './native-pivot-slicer-storage.js';
import { parseModelXml } from './data-model-metadata.js';
import { sheetKey } from './refs.js';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
/** PivotTable slicers as Excel parts: off until the parts are proven against a file Excel wrote, as
 * desktop Excel repaired ours away. Tests of the part writer turn it on; see xlsx-pivot-slicer-sidecar.js. */
export const nativePivotSlicerParts = { enabled: false };
const X14 = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
const X15 = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
const XR10 = 'http://schemas.microsoft.com/office/spreadsheetml/2016/revision10';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SR = 'http://schemas.microsoft.com/office/2007/relationships/';
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const extension = (xml, root, uri, body) => {
  const ext = tag('ext', { uri }, body);
  const tail = new RegExp(`</extLst>(\\s*</${root}>)`);
  return tail.test(xml) ? xml.replace(tail, `${ext}</extLst>$1`)
    : xml.replace(`</${root}>`, `${tag('extLst', {}, ext)}</${root}>`);
};
const relation = (xml, type, target) => {
  let n = 1;
  while (new RegExp(`\\bId=["']puterSlicer${n}["']`).test(xml)) n++;
  const id = `puterSlicer${n}`;
  return { id, xml: xml.replace('</Relationships>', tag('Relationship', { Id: id, Type: SR + type, Target: target }) + '</Relationships>') };
};

/** Reserve existing names before allocating new ones, so workbook ordering cannot
 * let a new control steal a later imported view/cache name. */
function allocateNames(entries, preferred, prefix, reserved = []) {
  const used = new Set(reserved.map(name => name.toUpperCase())), result = new Map();
  for (const entry of entries) {
    const name = preferred(entry);
    if (name && !used.has(name.toUpperCase())) { result.set(entry, name); used.add(name.toUpperCase()); }
  }
  let serial = 0;
  for (const entry of entries) if (!result.has(entry)) {
    let name;
    do { name = `${prefix}${++serial}`; } while (used.has(name.toUpperCase()));
    result.set(entry, name); used.add(name.toUpperCase());
  }
  return result;
}

/** Allocate identities against actual exported tables. Preserve distinct named
 * caches; new/duplicated views can share an existing matching table cache. */
export function prepareXlsxSlicers(wb) {
  const records = new Map(), tableIds = new Map(), pending = [], nativeViews = [];
  for (const sheet of wb.sheets) if (sheet.kind !== 'chart') for (const table of sheet.tables) tableIds.set(table, tableIds.size + 1);
  for (const sheet of wb.sheets) for (const control of sheet.charts) if (control.type === 'slicer') {
    if (sheet.kind === 'chart') throw new Error('Slicers require a worksheet owner');
    if (!control.paint) throw new Error('Cannot export slicer without a supported style');
    // PivotTable slicers go in the app's own data, not as Excel parts (see xlsx-pivot-slicer-sidecar.js).
    if (control.pivotCache != null) { if (nativePivotSlicerParts.enabled) nativeViews.push({ control, sheet }); continue; }
    const target = slicerTarget(wb, control);
    if (!target || !tableIds.has(target.table)) throw new Error('Cannot export slicer with a missing table column');
    const preferred = control.nativeCacheName;
    if (preferred && (preferred !== preferred.trim() || wb.validateName(preferred, preferred, { allowTableName: true }))) throw new Error('Invalid slicer cache name');
    const tableId = tableIds.get(target.table), column = target.col - target.table.range.c1 + 1;
    const options = { sortOrder: control.sortOrder, customListSort: Number(control.customListSort), crossFilter: control.crossFilter, hideItemsWithNoData: control.hideItemsWithNoData === true };
    pending.push({ control, sheet, preferred, key: JSON.stringify([tableId, column, options]),
      binding: { tableId, column, ...options, sourceName: wb.tableColumns(target.sheetId, target.table)[column - 1] } });
  }
  const caches = [], named = new Map(), byBinding = new Map(), preferences = new Map();
  const create = entry => {
    const cache = { ...entry.binding };
    caches.push(cache); preferences.set(cache, entry.preferred);
    if (!byBinding.has(entry.key)) byBinding.set(entry.key, cache);
    return cache;
  };
  const namedKey = entry => JSON.stringify([entry.key, entry.preferred.toUpperCase()]);
  for (const entry of pending) if (entry.preferred && !named.has(namedKey(entry))) named.set(namedKey(entry), create(entry));
  for (const entry of pending) {
    const cache = entry.preferred ? named.get(namedKey(entry)) : byBinding.get(entry.key) || create(entry);
    records.set(entry.control, { cache, sheet: entry.sheet });
  }
  for (const slicer of nativePivotSlicerParts.enabled ? prepareNativePivotSlicerCaches(wb.nativePivots?.slicers, wb.nativePivots, wb.sheets) : []) {
    if (slicer.name !== slicer.name.trim() || wb.validateName(slicer.name, slicer.name, { allowTableName: true })) throw new Error('Invalid slicer cache name');
    const cache = { ...slicer };
    caches.push(cache); preferences.set(cache, slicer.name);
  }
  const nativeCaches = new Map(caches.filter(cache => cache.kind === 'pivot').map(cache => [sheetKey(cache.name), cache]));
  for (const { control, sheet } of nativeViews) {
    const cache = nativeCaches.get(sheetKey(control.pivotCache));
    if (!cache) throw new Error('Cannot export slicer with a missing pivot cache');
    records.set(control, { cache, sheet });
  }
  // MS-XLSX 2.6.70: cache names share Excel's defined-name namespace.
  // MS-XLSX 2.3.2.3 associates each cache with a global #N/A defined name.
  // That companion is its own identity, not an unrelated namespace collision.
  const preferredNames = new Set([...preferences.values()].filter(Boolean).map(name => name.toUpperCase()));
  const unrelatedNames = wb.names.filter(n => n.sheet || n.ref !== '#N/A' || !preferredNames.has(n.name.toUpperCase()));
  const cacheNames = allocateNames(caches, cache => preferences.get(cache), 'PuterSlicerCache',
    [...unrelatedNames.map(n => n.name), ...[...tableIds.keys()].map(t => t.name)]);
  for (const cache of caches) cache.name = cacheNames.get(cache);
  // MS-XLSX 2.6.70: when any cache has an xr10 UID, every cache must have
  // a distinct one, including newly written table caches in a mixed workbook.
  const uids = new Set();
  for (const cache of caches) if (cache.kind === 'pivot') {
    const uid = parseModelXml(cache.xml).getAttributeNS(XR10, 'uid');
    if (!uid) continue;
    if (!/^\{[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\}$/i.test(uid) || uids.has(uid.toUpperCase())) throw new Error('Invalid or duplicate slicer cache UID');
    cache.uid = uid; uids.add(uid.toUpperCase());
  }
  if (uids.size) for (const cache of caches) if (!cache.uid) {
    let uid; do { uid = `{${crypto.randomUUID().toUpperCase()}}`; } while (uids.has(uid));
    cache.uid = uid; uids.add(uid);
  }
  const views = [...records.keys()], viewNames = allocateNames(views, control => control.nativeName, 'PuterSlicer');
  for (const control of views) records.get(control).name = viewNames.get(control);
  return { records, caches };
}

/** Emit shared native caches even when no visible views remain. */
export function writeXlsxSlicers(wb, plan, { get, set, contentType }) {
  if (!plan.caches.length) return;
  const controls = [...plan.records.keys()];
  const styled = appendSlicerStyles(get('/xl/styles.xml'), controls.map(c => c.paint), wb.colorPalette);
  set('/xl/styles.xml', styled.xml);
  const styleNames = new Map(controls.map((c, i) => [c, styled.names[i]]));
  const bySheet = new Map();
  for (const control of controls) {
    const sheet = plan.records.get(control).sheet;
    if (!bySheet.has(sheet)) bySheet.set(sheet, []);
    bySheet.get(sheet).push(control);
  }
  let rels = get('/xl/_rels/workbook.xml.rels');
  const cacheRefs = { table: '', pivot: '' };
  for (const [i, cache] of plan.caches.entries()) {
    const path = `/xl/slicerCaches/slicerCache${i + 1}.xml`;
    const { name, sourceName, hideItemsWithNoData, uid, ...binding } = cache;
    set(path, HEADER + (cache.kind === 'pivot' ? nativePivotSlicerCacheXml(cache, name, uid)
      : tag('x14:slicerCacheDefinition', { 'xmlns:x14': X14, 'xmlns:x15': X15, 'xmlns:x': MAIN,
        ...(uid ? { 'xmlns:xr10': XR10, 'xr10:uid': uid, 'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006', 'mc:Ignorable': 'xr10' } : {}),
        name: encodeXlsxAttribute(name), sourceName: encodeXlsxAttribute(sourceName) },
      tag('x14:extLst', {}, tag('x:ext', { uri: '{2F2917AC-EB37-4324-AD4E-5DD8C200BD13}' }, tag('x15:tableSlicerCache', binding))
        + (hideItemsWithNoData ? tag('x:ext', { uri: '{470722E0-AACD-4C17-9CDC-17EF765DBC7E}' }, tag('x15:slicerCacheHideItemsWithNoData')) : '')))));
    contentType(path, 'application/vnd.ms-excel.slicerCache+xml');
    const rel = relation(rels, 'slicerCache', `slicerCaches/slicerCache${i + 1}.xml`); rels = rel.xml;
    cacheRefs[cache.kind === 'pivot' ? 'pivot' : 'table'] += tag('x14:slicerCache', { 'r:id': rel.id });
  }
  set('/xl/_rels/workbook.xml.rels', rels);
  const existingNames = new Set(wb.names.filter(n => !n.sheet && n.ref === '#N/A').map(n => n.name.toUpperCase()));
  const companions = plan.caches.filter(cache => !existingNames.has(cache.name.toUpperCase()))
    .map(cache => tag('definedName', { name: encodeXlsxAttribute(cache.name) }, '#N/A')).join('');
  let workbook = get('/xl/workbook.xml');
  if (companions) workbook = workbook.includes('</definedNames>')
    ? workbook.replace('</definedNames>', `${companions}</definedNames>`)
    : workbook.replace(/<(?:calcPr|oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/,
      match => tag('definedNames', {}, companions) + match);
  if (cacheRefs.table) workbook = extension(workbook, 'workbook', '{46BE6895-7355-4a93-B00E-2C351335B9C9}',
    tag('x15:slicerCaches', { 'xmlns:x15': X15, 'xmlns:x14': X14, 'xmlns:r': REL }, cacheRefs.table));
  if (cacheRefs.pivot) workbook = extension(workbook, 'workbook', '{BBE1A952-AA13-448E-AADC-164F8A28A991}',
    tag('x14:slicerCaches', { 'xmlns:x14': X14, 'xmlns:r': REL }, cacheRefs.pivot));
  set('/xl/workbook.xml', workbook);
  for (const [i, sheet] of wb.sheets.entries()) {
    for (const pivot of [false, true]) {
      const owned = (bySheet.get(sheet) || []).filter(control => (control.pivotCache != null) === pivot);
      if (!owned.length) continue;
      const filename = `slicer${i + 1}${pivot ? 'Pivot' : ''}.xml`;
      const path = `/xl/slicers/${filename}`;
      set(path, HEADER + tag('x14:slicers', { 'xmlns:x14': X14 }, owned.map(c => tag('x14:slicer', {
        name: encodeXlsxAttribute(plan.records.get(c).name), cache: encodeXlsxAttribute(plan.records.get(c).cache.name), caption: c.title ? encodeXlsxAttribute(c.title) : null,
        startItem: c.startItem, columnCount: c.columnCount, showCaption: Number(c.showCaption),
        style: encodeXlsxAttribute(styleNames.get(c)), lockedPosition: Number(c.lockedPosition), rowHeight: c.rowHeight,
      })).join('')));
      contentType(path, 'application/vnd.ms-excel.slicer+xml');
      const relPath = `/xl/worksheets/_rels/sheet${i + 1}.xml.rels`;
      const rel = relation(get(relPath), 'slicer', `../slicers/${filename}`);
      set(relPath, rel.xml);
      const sheetPath = `/xl/worksheets/sheet${i + 1}.xml`;
      set(sheetPath, extension(get(sheetPath), 'worksheet', pivot ? '{A8765BA9-456A-4dab-B4F3-ACF838C121DE}' : '{3A4CF648-6AED-40f4-86FF-DC5316D8AED3}',
        tag('x14:slicerList', { 'xmlns:x14': X14, 'xmlns:r': REL }, tag('x14:slicer', { 'r:id': rel.id }))));
    }
  }
}

/** The drawing reference is a real slicer frame, with an explicit old-client fallback. */
export function slicerFrameXml(control, id, name) {
  const SLE = 'http://schemas.microsoft.com/office/drawing/2010/slicer';
  const pivot = control.pivotCache != null;
  const props = tag('xdr:cNvPr', { id, name, descr: control.description || null, hidden: control.hidden ? 1 : null });
  const frame = tag('xdr:graphicFrame', { macro: '' }, tag('xdr:nvGraphicFramePr', {}, props + tag('xdr:cNvGraphicFramePr'))
    + tag('xdr:xfrm', {}, tag('a:off', { x: 0, y: 0 }) + tag('a:ext', { cx: 0, cy: 0 }))
    + tag('a:graphic', {}, tag('a:graphicData', { uri: SLE }, tag('sle:slicer', { 'xmlns:sle': SLE, name }))));
  const fallback = tag('xdr:sp', {}, tag('xdr:nvSpPr', {}, props + tag('xdr:cNvSpPr', { txBox: 1 }))
    + tag('xdr:spPr', {}, tag('a:prstGeom', { prst: 'rect' }, tag('a:avLst')))
    + tag('xdr:txBody', {}, tag('a:bodyPr') + tag('a:lstStyle') + tag('a:p', {}, tag('a:r', {}, tag('a:t', {}, `This workbook contains a ${pivot ? 'pivot' : 'table'} slicer. Use an application that supports ${pivot ? 'pivot' : 'table'} slicers to filter it.`)))));
  return tag('mc:AlternateContent', { 'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    ...(pivot ? { 'xmlns:a14': 'http://schemas.microsoft.com/office/drawing/2010/main' } : { 'xmlns:sle15': 'http://schemas.microsoft.com/office/drawing/2012/slicer' }) },
    tag('mc:Choice', { Requires: pivot ? 'a14' : 'sle15' }, frame) + tag('mc:Fallback', {}, fallback));
}
