import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { dashboardImage } from './helpers/xlsx-dashboard-fixture.js';
import { readXlsxRichValues } from '../src/core/xlsx-rich-values.js';

const text = (zip, path) => new TextDecoder().decode(X.CFB.find(zip, path)?.content);
const set = (zip, path, value) => X.CFB.utils.cfb_add(zip, path, new TextEncoder().encode(value));
async function exported(wb) {
  const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
  set(zip, '/xl/workbook.xml', text(zip, '/xl/workbook.xml').replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, ''));
  return zip;
}
const reopen = zip => workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native.xlsx');
const values = zip => readXlsxRichValues(X.read(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), { type: 'array', bookFiles: true }));

it.each([false, true])('exports calculation errors with valid legacy fallbacks and shared rich metadata (pictures=%s)', async pictures => {
  const w = new Workbook(), id = w.activeSheetId;
  const picture = { image: `data:image/png;base64,${dashboardImage}`, fit: 'contain' };
  w.setCells(id, [{ r: 0, c: 0, cell: { v: { error: '#CALC!' } } }, { r: 0, c: 1, cell: { v: { error: '#VALUE!' } } }]);
  w.setInput(id, 2, 0, '=FILTER({1;2},{FALSE;FALSE})');
  w.setInput(id, 4, 0, '=SEQUENCE(2)');
  if (pictures) {
    w.setCells(id, [{ r: 1, c: 3, cell: { v: picture } }]);
    w.setInput(id, 2, 3, '=D2');
  }
  const zip = await exported(w), sheet = text(zip, '/xl/worksheets/sheet1.xml');
  expect(sheet).not.toContain('#CALC!');
  expect(sheet).toMatch(/<c\b[^>]*r="A1"[^>]*vm="1"[^>]*><v>#VALUE!<\/v>/);
  expect(sheet).toMatch(/<c\b[^>]*r="A3"[^>]*vm="1"/);
  expect(text(zip, '/xl/richData/rdrichvaluestructure.xml')).toContain('<k n="errorType" t="i"/>');
  expect(text(zip, '/xl/metadata.xml')).toContain('name="XLDAPR"');
  expect(text(zip, '/xl/metadata.xml')).toContain('name="XLRICHVALUE"');
  expect(values(zip).get(1)).toEqual({ error: '#CALC!' });
  for (let pass = 0, back = await reopen(zip); pass < 2; pass++, back = await reopen(await exported(back))) {
    expect(back.getValue(back.activeSheetId, 0, 0)).toEqual({ error: '#CALC!' });
    expect(back.getValue(back.activeSheetId, 0, 1)).toEqual({ error: '#VALUE!' });
    expect(back.getValue(back.activeSheetId, 2, 0)).toEqual({ error: '#CALC!' });
    expect(back.getValue(back.activeSheetId, 5, 0)).toBe(2);
    if (pictures) {
      expect(back.getValue(back.activeSheetId, 1, 3)).toEqual(picture);
      expect(back.getValue(back.activeSheetId, 2, 3)).toEqual(picture);
    }
    back.setInput(back.activeSheetId, 2, 0, '=FILTER({1;2},{TRUE;TRUE})');
    expect(back.getValue(back.activeSheetId, 3, 0)).toBe(2);
    back.undo();
  }
});

it('resolves reordered namespaced rich keys and ignores unrelated error types', async () => {
  const w = new Workbook();
  w.setCells(w.activeSheetId, [{ r: 0, c: 0, cell: { v: { error: '#CALC!' } } }]);
  const zip = await exported(w);
  set(zip, '/xl/richData/rdrichvaluestructure.xml', '<rd:rvStructures xmlns:rd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><rd:s t="_error"><rd:k n="subType" t="i"/><rd:k n="errorType" t="i"/></rd:s></rd:rvStructures>');
  set(zip, '/xl/richData/rdrichvalue.xml', '<rd:rvData xmlns:rd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata"><rd:rv s="0"><rd:v>3</rd:v><rd:v> +013 </rd:v></rd:rv></rd:rvData>');
  expect(values(zip).get(1)).toEqual({ error: '#CALC!' });
  set(zip, '/xl/richData/rdrichvalue.xml', text(zip, '/xl/richData/rdrichvalue.xml').replace('+013', '99'));
  expect(values(zip).size).toBe(0);
  const back = await reopen(zip);
  expect(back.getValue(back.activeSheetId, 0, 0)).toEqual({ error: '#VALUE!' });
});

it.each(['s=""', 's="-1"', 's="99"', '', 's="0.0"'])('does not guess an invalid or missing rich structure index: %s', async attribute => {
  const w = new Workbook();
  w.setCells(w.activeSheetId, [{ r: 0, c: 0, cell: { v: { error: '#CALC!' } } }]);
  const zip = await exported(w);
  set(zip, '/xl/richData/rdrichvalue.xml', text(zip, '/xl/richData/rdrichvalue.xml').replace('s="0"', attribute));
  expect(values(zip).size).toBe(0);
});
