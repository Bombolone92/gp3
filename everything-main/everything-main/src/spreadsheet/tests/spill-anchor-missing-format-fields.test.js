import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookToOds } from '../src/core/io.js';
import * as X from '../src/vendor/xlsx.mjs';

const anchor = { r1: 0, c1: 0, r2: 0, c2: 0 };
function book(style = { fmt: 'percent', dec: 1 }) {
  return new Workbook({ sheets: [{ name: 'Values', colStyles: { 1: style },
    cells: { '0,0': { f: 'SEQUENCE(1,2)' } },
  }] });
}

it.each([{ bold: true }, { bg: '#ffff00' }, { align: 'center' }])('keeps a spill destination\'s number format when the anchor gets %j', (patch) => {
  const wb = book(), id = wb.activeSheetId;
  expect(wb.getDisplay(id, 0, 1)).toBe('200.0%');
  wb.applyStyle(id, anchor, patch);
  expect(wb.getDisplay(id, 0, 1)).toBe('200.0%');
  const copied = wb.copyRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 })[0][0];
  expect(copied.s).toMatchObject({ fmt: 'percent', dec: 1 });
  wb.undo();
  expect(wb.getDisplay(id, 0, 1)).toBe('200.0%');
  wb.redo();
  expect(wb.getDisplay(id, 0, 1)).toBe('200.0%');
});

it('overrides only number-format fields the anchor actually carries, including zero and false', () => {
  const wb = book({ fmt: 'number', dec: 1, group: true }), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { f: 'SEQUENCE(1,2,1000)', s: { dec: 0, group: false } } }]);
  expect(wb.getDisplay(id, 0, 1)).toBe('1001');
  const copied = wb.copyRange(id, { r1: 0, c1: 1, r2: 0, c2: 1 })[0][0];
  expect(copied.s).toMatchObject({ fmt: 'number', dec: 0, group: false });
});

it.each(['general', null])('keeps an explicit %s format reset from the anchor', (fmt) => {
  const wb = book(), id = wb.activeSheetId;
  wb.setCells(id, [{ r: 0, c: 0, cell: { f: 'SEQUENCE(1,2)', s: { fmt } } }]);
  expect(wb.getDisplay(id, 0, 1)).toBe('2');
});

it.each(['xlsx', 'ods'])('exports a destination\'s custom code despite a bold anchor (%s)', async (kind) => {
  const wb = book({ fmt: 'custom', code: '0.00" kg"' });
  wb.applyStyle(wb.activeSheetId, anchor, { bold: true });
  const blob = await (kind === 'xlsx' ? workbookToXlsx(wb) : workbookToOds(wb));
  const saved = X.read(await blob.arrayBuffer(), { type: 'array', cellNF: true });
  expect(X.SSF.format(saved.Sheets.Values.B1.z, saved.Sheets.Values.B1.v)).toBe('2.00 kg');
});
