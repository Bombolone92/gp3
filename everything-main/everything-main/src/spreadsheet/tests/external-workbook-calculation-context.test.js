import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';
const linked = "'[1]Data'!$A$1";
const cases = [
  ['LEN("😀a")', 2, 3],
  ['MID("😀ab",3,1)', 'b', 'a'],
  ['FIND("a","😀a")', 2, 3],
  ['SEARCH("A","😀a")', 2, 3],
  ['REPLACE("😀ab",3,1,"X")', '😀aX', '😀Xb'],
];
function source(expression, version = 2, names = []) {
  const f = `${linked}&"|"&${expression}`;
  const known = new Workbook({ calculationCompatibility: { version }, names,
    externalWorkbooks: { version: 1, books: [{ target: '/Source.xlsx', sheets: [{ name: 'Data', cells: { '0,0': 40 } }] }] },
    sheets: [{ name: 'Report', cells: { '0,0': { f } } }] });
  const value = known.getValue(known.activeSheetId, 0, 0), json = known.toJSON();
  json.externalWorkbooks.books[0].sheets[0].cells = null;
  json.sheets[0].cells['0,0'].externalResult = { formula: f, value };
  return new Workbook(json);
}
function transfer(wb, version) {
  const dest = new Workbook({ calculationCompatibility: { version }, names: wb.names, sheets: [{ name: 'Report' }] });
  dest.pasteCells(dest.activeSheetId, wb.copyCells(wb.activeSheetId, [0], [0]), 0, 0, { r: 0, c: 0 }, null,
    { externalWorkbooks: wb.externalWorkbooks });
  return dest;
}
const value = wb => wb.getValue(wb.activeSheetId, 0, 0);

it.each(cases)('invalidates %s saved under a different compatibility version', (expression, modern, legacy) => {
  const wb = source(expression);
  expect(value(wb)).toBe(`40|${modern}`);
  expect(value(transfer(wb, 2))).toBe(`40|${modern}`);
  const dest = transfer(wb, 1);
  expect(value(dest)).toEqual({ error: '#REF!' });
  const json = dest.toJSON(); json.externalWorkbooks.books[0].sheets[0].cells = { '0,0': 40 };
  expect(value(new Workbook(json))).toBe(`40|${legacy}`);
});
it.each(cases)('also invalidates %s when moving from legacy to modern', expression => {
  const wb = source(expression, 1);
  expect(value(transfer(wb, 1))).toEqual(value(wb));
  expect(value(transfer(wb, 2))).toEqual({ error: '#REF!' });
});
it.each(['LEN("abc")', 'LET(text,"😀",LEN(text))', 'LAMBDA(text,LEN(text))("😀")', 'LengthOfText'])('follows setting reads in %s without evaluating unavailable data', expression => {
  const wb = source(expression, 2, [{ name: 'LengthOfText', ref: 'LEN("😀")' }]);
  expect(value(transfer(wb, 1))).toEqual({ error: '#REF!' });
});
it.each(['SUM(1,2)', 'LEFT("😀a",1)', 'RIGHT("a😀",1)', 'UPPER("text")', '2+3'])('keeps setting-independent %s portable', expression => {
  const wb = source(expression);
  expect(value(transfer(wb, 1))).toEqual(value(wb));
});
it('does not confuse the warning version with the calculation version', () => {
  const json = source('LEN("😀")').toJSON();
  json.calculationCompatibility.warnBelowVersion = 1;
  expect(value(new Workbook(json))).toBe('40|1');
});
it('preserves declared future versions without treating a different version as equivalent', () => {
  const wb = source('LEN("😀")', 3);
  expect(value(transfer(wb, 3))).toBe('40|1');
  expect(value(transfer(wb, 2))).toEqual({ error: '#REF!' });
});
it.each([0, -1, 1.5, '2', 0x100000000, null])('rejects malformed compatibility provenance %j', compatibilityVersion => {
  const json = source('LEN("😀")').toJSON();
  json.sheets[0].cells['0,0'].externalResult.context.compatibilityVersion = compatibilityVersion;
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('does not upgrade old provenance which cannot certify the calculation version', () => {
  const json = source('LEN("😀")').toJSON();
  delete json.sheets[0].cells['0,0'].externalResult.context.compatibilityVersion;
  expect(value(new Workbook(json))).toEqual({ error: '#REF!' });
});
it('preserves provenance across JSON, undo/redo, and a same-version sheet copy', () => {
  const wb = source('LEN("😀")'), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '7'); wb.undo(); expect(value(wb)).toBe('40|1');
  wb.redo(); expect(value(wb)).toBe(7);
  wb.undo(); expect(value(new Workbook(wb.toJSON()))).toBe('40|1');
  expect(value(wb.sheetToWorkbook(id))).toBe('40|1');
});
it.each([1, 2])('writes the correct native result for destination version %s', async version => {
  let wb = transfer(source('LEN("😀")'), version);
  const expected = version === 1 ? { error: '#REF!' } : '40|1';
  for (let cycle = 0; cycle < 2; cycle++) {
    const zip = X.CFB.read(new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer()), { type: 'array' });
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    X.CFB.utils.cfb_add(zip, '/xl/workbook.xml', new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta\d*"[^>]*\/>/g, '')));
    wb = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }));
    expect(wb.calculationCompatibility.version).toBe(version);
    expect(value(wb)).toEqual(expected);
  }
});
it.each([1, 2])('respects destination version %s when importing a sheet with saved results', version => {
  const wb = source('LEN("😀")'), dest = new Workbook({ calculationCompatibility: { version } });
  const [sheet] = dest.importSheets(wb);
  expect(dest.calculationCompatibility.version).toBe(version);
  expect(dest.getValue(sheet.id, 0, 0)).toEqual(version === 2 ? '40|1' : { error: '#REF!' });
});
it('follows compatibility reads inside supporting-workbook names', () => {
  const json = source('1').toJSON(), f = `${linked}&"|"&'[1]Data'!LengthOfText`;
  json.externalWorkbooks.books[0].names = [{ name: 'LengthOfText', ref: 'LEN("😀")' }];
  json.sheets[0].cells['0,0'] = { f, externalResult: { formula: f, value: '40|1' } };
  const wb = new Workbook(json);
  expect(value(transfer(wb, 2))).toBe('40|1');
  expect(value(transfer(wb, 1))).toEqual({ error: '#REF!' });
});
