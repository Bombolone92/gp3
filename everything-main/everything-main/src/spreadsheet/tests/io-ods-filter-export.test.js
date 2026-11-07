import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToOds } from '../src/core/io.js';
const parser = new (new JSDOM('').window.DOMParser)();
const NS = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
function source(rows = [['Value'], [3], [9]]) {
  const wb = new Workbook(), id = wb.activeSheetId;
  rows.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
  wb.setFilterRange(id, { r1: 0, c1: 0, r2: rows.length - 1, c2: rows[0].length - 1 });
  return wb;
}
async function exported(wb) {
  const bytes = new Uint8Array(await (await workbookToOds(wb)).arrayBuffer());
  const zip = X.CFB.read(bytes, { type: 'array' });
  const content = new TextDecoder().decode(X.CFB.find(zip, 'content.xml').content);
  return { bytes, zip, doc: parser.parseFromString(content, 'application/xml') };
}
const hidden = wb => [...wb.activeSheet.filterHidden];
it.each([
  { op: 'gt', value: 5 }, { op: 'between', value: 9, value2: 4 }, { op: 'eq', value: 3 },
  { op: 'neq', value: 3 }, { values: ['9'], keys: ['9'] }, { values: [] }, { formula: '=A2>5' }, { text: '9' },
])('preserves filter %j and keeps it live over repeated saves', async criteria => {
  let wb = source(); wb.setFilterCriteria(wb.activeSheetId, 0, criteria);
  const expected = hidden(wb);
  for (let i = 0; i < 2; i++) {
    const before = wb.toJSON(), result = await exported(wb);
    expect(wb.toJSON()).toEqual(before);
    wb = await workbookFromFile(result.bytes, 'filtered.ods');
    expect(wb.sheets).toHaveLength(1); expect(wb.activeSheet.filter.criteria).toEqual({ 0: criteria });
    expect(hidden(wb)).toEqual(expected);
  }
  wb.setInput(wb.activeSheetId, 1, 0, '9'); wb.reapplyFilter(wb.activeSheetId);
  const comparison = source([['Value'], [9], [9]]); comparison.setFilterCriteria(comparison.activeSheetId, 0, criteria);
  expect(hidden(wb)).toEqual(hidden(comparison));
});
it.each([
  [{ op: 'gt', value: 5 }, ['>']], [{ op: 'between', value: 9, value2: 4 }, ['>=', '<=']],
  [{ op: 'contains', value: '*?' }, ['contains']], [{ op: 'notContains', value: '*?' }, ['!contains']],
  [{ op: 'beginsWith', value: 'A' }, ['begins']], [{ op: 'endsWith', value: 'Z' }, ['ends']],
  [{ op: 'empty' }, ['empty']], [{ op: 'notEmpty' }, ['!empty']],
])('writes native conditions for %j', async (criteria, operators) => {
  const wb = source(); wb.setFilterCriteria(wb.activeSheetId, 0, criteria);
  const { doc } = await exported(wb);
  expect([...doc.getElementsByTagNameNS(NS, 'filter-condition')].map(n => n.getAttributeNS(NS, 'operator'))).toEqual(operators);
});
it('writes field offsets, AND conditions and literal case-sensitive value sets for other readers', async () => {
  const wb = source([['Outside', 'Amount', 'Text'], ['x', 3, '& "a"*?'], ['x', 9, 'yes']]);
  wb.setFilterRange(wb.activeSheetId, { r1: 0, c1: 1, r2: 2, c2: 2 });
  wb.setFilterCriteria(wb.activeSheetId, 1, { op: 'gt', value: 5 });
  wb.setFilterCriteria(wb.activeSheetId, 2, { values: ['yes', '& "a"*?'] });
  const { zip, doc } = await exported(wb);
  const conditions = [...doc.getElementsByTagNameNS(NS, 'filter-condition')];
  expect(conditions.map(n => n.getAttributeNS(NS, 'field-number'))).toEqual(['0', '1']);
  expect(doc.getElementsByTagNameNS(NS, 'filter-and')).toHaveLength(1);
  expect(conditions[1].getAttributeNS(NS, 'case-sensitive')).toBe('true');
  expect([...doc.getElementsByTagNameNS(NS, 'filter-set-item')].map(n => n.getAttributeNS(NS, 'value'))).toEqual(['yes', '& "a"*?']);
  X.CFB.utils.cfb_del(zip, 'settings.xml');
  const native = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.ods');
  expect(hidden(native)).toEqual([1]);
});
it('retains conditional fill dependencies for color filters', async () => {
  const wb = source();
  wb.addRule(wb.activeSheetId, { range: { r1: 1, c1: 0, r2: 2, c2: 0 }, type: 'gt', value: 5, style: { bg: '#ff0000' } });
  wb.setFilterCriteria(wb.activeSheetId, 0, { color: '#ff0000' });
  expect(hidden(wb)).toEqual([1]);
  const imported = await workbookFromFile(await workbookToOds(wb), 'color.ods');
  expect(hidden(imported)).toEqual([1]);
  imported.setInput(imported.activeSheetId, 1, 0, '10'); imported.reapplyFilter(imported.activeSheetId);
  expect(hidden(imported)).toEqual([]);
});
it('retains table and name dependencies for custom filters without a visible metadata sheet', async () => {
  const wb = source(); wb.addTable(wb.activeSheetId, { r1: 0, c1: 0, r2: 2, c2: 0 }, { name: 'Items' });
  wb.defineName('Limit', 'AVERAGE(Items[Value])');
  wb.setFilterCriteria(wb.activeSheetId, 0, { formula: 'Items[@Value]>Limit' });
  expect(hidden(wb)).toEqual([1]);
  const { bytes } = await exported(wb), raw = X.read(bytes, { type: 'array' });
  expect(raw.SheetNames).toEqual(['Sheet1']);
  const imported = await workbookFromFile(bytes, 'table.ods');
  expect(hidden(imported)).toEqual([1]); expect(imported.activeSheet.tables[0].name).toBe('Items');
  imported.setInput(imported.activeSheetId, 1, 0, '12'); imported.reapplyFilter(imported.activeSheetId);
  expect(hidden(imported)).toEqual([2]);
});
it('retains Unicode, XML-looking text and large value lists in settings', async () => {
  const wb = source([['Text'], ['😀 & "<tag>"'], ['Other']]);
  const values = Array.from({ length: 5000 }, (_, i) => `Option ${i}`); values.push('😀 & "<tag>"', '_x0041_');
  wb.setFilterCriteria(wb.activeSheetId, 0, { values });
  const imported = await workbookFromFile(await workbookToOds(wb), 'values.ods');
  expect(imported.activeSheet.filter.criteria[0].values).toEqual(values); expect(hidden(imported)).toEqual([2]);
});
it('does not publish a partial native AND when a custom criterion has no ODF equivalent', async () => {
  const wb = source([['Value', 'Flag'], [3, 'x'], [9, 'y']]);
  wb.setFilterCriteria(wb.activeSheetId, 0, { op: 'gt', value: 5 });
  wb.setFilterCriteria(wb.activeSheetId, 1, { formula: 'B2="y"' });
  const { doc, bytes } = await exported(wb);
  expect(doc.getElementsByTagNameNS(NS, 'filter-condition')).toHaveLength(0);
  expect(hidden(await workbookFromFile(bytes, 'mixed.ods'))).toEqual([1]);
});
it('does not add settings to ordinary unfiltered files', async () => {
  const { zip } = await exported(new Workbook()); expect(X.CFB.find(zip, 'settings.xml')).toBeNull();
});
it('ignores damaged application settings and retains native conditions', async () => {
  const wb = source(); wb.setFilterCriteria(wb.activeSheetId, 0, { op: 'gt', value: 5 });
  const { zip } = await exported(wb);
  const settings = new TextDecoder().decode(X.CFB.find(zip, 'settings.xml').content).replace('{&quot;v&quot;:1', '{invalid');
  X.CFB.utils.cfb_add(zip, 'settings.xml', new TextEncoder().encode(settings));
  expect(hidden(await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'damaged.ods'))).toEqual([1]);
});
it.each(['alias', 'wrong-namespace', 'unsupported-version', 'comment'])('reads only recognized settings with %s', async variant => {
  const wb = source(); wb.setFilterCriteria(wb.activeSheetId, 0, { op: 'gt', value: 5 });
  const { zip } = await exported(wb);
  let settings = new TextDecoder().decode(X.CFB.find(zip, 'settings.xml').content);
  if (variant === 'alias') settings = settings.replaceAll('<config:', '<cfg:').replaceAll('</config:', '</cfg:').replaceAll(' config:', ' cfg:').replaceAll('xmlns:config=', 'xmlns:cfg=');
  if (variant === 'wrong-namespace') settings = settings.replace('urn:oasis:names:tc:opendocument:xmlns:config:1.0', 'urn:unrelated');
  if (variant === 'unsupported-version') settings = settings.replace('&quot;v&quot;:1', '&quot;v&quot;:2');
  if (variant === 'comment') settings = '<!--' + settings.replace(/^<\?xml[^>]*>\s*/, '') + '-->';
  X.CFB.utils.cfb_add(zip, 'settings.xml', new TextEncoder().encode(settings));
  const imported = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'settings.ods');
  expect(hidden(imported)).toEqual([1]);
  if (variant === 'alias') expect(imported.activeSheet.filter.criteria[0].op).toBe('gt');
  else expect(imported.activeSheet.filter.criteria[0].formula).toBeTypeOf('string');
});
it('carries filter settings through flat OpenDocument output', async () => {
  const wb = source(); wb.setFilterCriteria(wb.activeSheetId, 0, { formula: 'A2>5' });
  const { bytes } = await exported(wb), raw = X.read(bytes, { type: 'array' });
  const fods = X.write(raw, { type: 'array', bookType: 'fods' });
  const imported = await workbookFromFile(fods, 'filter.fods');
  expect(imported.activeSheet.filter.criteria).toEqual({ 0: { formula: 'A2>5' } }); expect(hidden(imported)).toEqual([1]);
});
it.each([{ values: [] }, { op: 'contains', value: '' }, { op: 'gt', value: 'invalid' }])('keeps reject-all criteria %j in native ODF without settings', async criteria => {
  const wb = source(); wb.setFilterCriteria(wb.activeSheetId, 0, criteria);
  const { zip } = await exported(wb); X.CFB.utils.cfb_del(zip, 'settings.xml');
  const imported = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.ods');
  expect(hidden(imported)).toEqual([1, 2]);
});

it('writes insensitive value sets with the native ODS comparison flag', async () => {
  const wb = source([['Value'], ['Alpha'], ['ALPHA'], ['Beta']]);
  wb.setFilterCriteria(wb.activeSheetId, 0, { values: ['alpha'], caseSensitive: false });
  const { doc } = await exported(wb);
  expect(doc.getElementsByTagNameNS(NS, 'filter-condition')[0].getAttributeNS(NS, 'case-sensitive')).toBe('false');
  const bytes = await workbookToOds(wb, { settings: false });
  const native = await workbookFromFile(bytes, 'native.ods');
  native.reapplyFilter(native.activeSheetId);
  expect(hidden(native)).toEqual([3]);
});
