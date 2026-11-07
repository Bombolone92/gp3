import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

function book(axis, own) {
  const style = { fmt: 'currency', cur: 'USD', dec: 2, bold: true, bg: '#ffff00' };
  return new Workbook({ sheets: [{ name: 'Prices',
    ...(axis === 'row' ? { rowStyles: { 0: style } } : { colStyles: { 0: style } }),
    cells: { '0,0': { f: axis === 'row' ? 'SEQUENCE(3)' : 'SEQUENCE(1,3)', ...(own ? { s: own } : {}) } },
  }] });
}

it.each(['row', 'col'])('spills the anchor\'s inherited %s number format beyond that line', (axis) => {
  const wb = book(axis), id = wb.activeSheetId;
  const positions = [0, 1, 2].map((i) => axis === 'row' ? [i, 0] : [0, i]);
  expect(positions.map(([r, c]) => wb.getDisplay(id, r, c))).toEqual(['$1.00', '$2.00', '$3.00']);
  const [r, c] = positions[1];
  expect(wb.getCell(id, 0, 0).s).toBeUndefined();
  expect(wb.getCell(id, r, c)).toBeUndefined();
  const copied = wb.copyRange(id, { r1: r, c1: c, r2: r, c2: c })[0][0];
  expect(copied.v).toBe(2);
  expect(copied.s).toMatchObject({ fmt: 'currency', cur: 'USD', dec: 2 });
  expect(copied.s.bold).toBeUndefined();
  expect(copied.s.bg).toBeUndefined();
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { cur: 'EUR' });
  expect(wb.getDisplay(id, r, c)).toBe('€2.00');
  wb.undo();
  expect(wb.getDisplay(id, r, c)).toBe('$2.00');
});

it('combines the inherited format with the anchor\'s partial override', () => {
  const wb = book('row', { dec: 3 }), id = wb.activeSheetId;
  expect(wb.getDisplay(id, 1, 0)).toBe('$2.000');
  wb.clearRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { contents: false, styles: true });
  expect(wb.getDisplay(id, 1, 0)).toBe('2');
  wb.undo();
  expect(wb.getDisplay(id, 1, 0)).toBe('$2.000');
});

it.each(['xlsx', 'ods'])('exports and reopens an array whose anchor inherits its number format (%s)', async (kind) => {
  const wb = book('row');
  const blob = await (kind === 'xlsx' ? workbookToXlsx(wb) : workbookToOds(wb));
  const native = X.read(await blob.arrayBuffer(), { type: 'array', cellNF: true });
  for (const addr of ['A1', 'A2', 'A3']) expect(native.Sheets.Prices[addr].z, addr).toContain('$');
  const back = await workbookFromFile(blob, `Prices.${kind}`);
  expect([0, 1, 2].map((r) => back.getDisplay(back.activeSheetId, r, 0))).toEqual(['$1.00', '$2.00', '$3.00']);
  expect(back.getCell(back.activeSheetId, 0, 0).s).toBeUndefined();
});
