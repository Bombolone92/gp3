import { expect, it } from 'vitest';
import * as X from '../src/vendor/xlsx.mjs';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx, workbookToOds } from '../src/core/io.js';

function book() {
  return new Workbook({ sheets: [{ name: 'Prices', rows: 400, cols: 26,
    colStyles: { 1: { fmt: 'currency', cur: 'USD', dec: 2 } },
    rowStyles: { 4: { fmt: 'percent', dec: 1 } },
    cells: {
      '2,1': { v: 12 }, '3,1': { f: 'B3*2' }, '4,1': { v: 0.25 },
      '5,1': { v: 1.5, s: { dec: 3, bold: true } }, '6,1': { v: 2, s: { fmt: null } },
      '7,1': { v: 3 }, '8,1': { v: 4, s: { fmt: 'custom', code: '0.0" kg"' } },
      '9,1': { v: 5, s: { fmt: null, dec: 4 } },
      '2,4': { v: 0.75, s: { fmt: 'percent', dec: 0 } },
    },
  }] });
}
const save = (wb, kind) => kind === 'xlsx' ? workbookToXlsx(wb) : workbookToOds(wb);
async function withoutSidecar(blob, kind) {
  if (kind === 'ods') {
    const back = X.read(await blob.arrayBuffer(), { type: 'array', cellNF: true, cellFormula: true });
    delete back.PuterSettings;
    return X.write(back, { type: 'array', bookType: 'ods' });
  }
  const back = X.read(await blob.arrayBuffer(), { type: 'array', cellNF: true, cellFormula: true });
  back.SheetNames = ['Prices'];
  back.Workbook.Sheets = back.Workbook.Sheets.filter((s) => s.name === 'Prices');
  return X.write(back, { type: 'array', bookType: 'xlsx' });
}

it.each(['xlsx', 'ods'])('writes inherited formats into native %s cells for other spreadsheet apps', async (kind) => {
  const wb = book(), id = wb.activeSheetId;
  wb.clearRange(id, { r1: 7, r2: 7, c1: 1, c2: 1 }, { contents: false, styles: true });
  const bytes = await withoutSidecar(await save(wb, kind), kind);
  const back = await workbookFromFile(bytes, `External.${kind}`);
  expect(back.sheet(back.activeSheetId).colStyles.size).toBe(0);
  expect(back.sheet(back.activeSheetId).rowStyles.size).toBe(0);
  for (let r = 2; r <= 8; r++) expect(back.getDisplay(back.activeSheetId, r, 1), `row ${r + 1}`).toBe(wb.getDisplay(id, r, 1));
  expect(back.getDisplay(back.activeSheetId, 2, 4)).toBe('75%');
});

it.each(['xlsx', 'ods'])('retains inheritance and partial overrides on reopening its own %s export', async (kind) => {
  const wb = book(), id = wb.activeSheetId;
  wb.clearRange(id, { r1: 7, r2: 7, c1: 1, c2: 1 }, { contents: false, styles: true });
  const back = await workbookFromFile(await save(wb, kind), `Own.${kind}`), bid = back.activeSheetId;
  expect(back.getCell(bid, 2, 1)?.s?.fmt).toBeUndefined();
  expect(back.getCell(bid, 5, 1)?.s).toEqual({ dec: 3, bold: true });
  expect(back.getCell(bid, 9, 1)?.s).toEqual({ fmt: null, dec: 4 });
  for (let r = 2; r <= 8; r++) expect(back.getDisplay(bid, r, 1)).toBe(wb.getDisplay(id, r, 1));
  // The row's format must continue to win over the column's at the original intersections.
  back.applyStyle(bid, { r1: 0, r2: 399, c1: 1, c2: 1 }, { cur: 'EUR' });
  expect(back.getDisplay(bid, 2, 1)).toBe('€12.00');
  expect(back.getDisplay(bid, 5, 1)).toBe('€1.500');
  expect(back.getDisplay(bid, 4, 1)).toBe('25.0%');
});

it.each(['xlsx', 'ods'])('exports spilled values with their inherited destination format in %s', async (kind) => {
  const wb = new Workbook({ sheets: [{ name: 'Prices', colStyles: { 1: { fmt: 'currency', cur: 'USD', dec: 2 } },
    cells: { '1,1': { f: 'SEQUENCE(3)' } },
  }] });
  const bytes = await withoutSidecar(await save(wb, kind), kind);
  const file = X.read(bytes, { type: 'array', cellNF: true });
  const own = await workbookFromFile(await save(wb, kind), `Own.${kind}`);
  for (const address of ['B2', 'B3', 'B4']) expect(file.Sheets.Prices[address].z, address).toContain('$');
  for (let r = 1; r <= 3; r++) expect(own.getDisplay(own.activeSheetId, r, 1)).toBe(wb.getDisplay(wb.activeSheetId, r, 1));
});
