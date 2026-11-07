import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The format a typed formula implies read the referenced cell's own style alone, so a column formatted
// Currency suggested nothing for the rows the sheet had not reached yet — the very rows such a format is
// kept on the line for — and a formula pointing into them came out a bare number beside the prices.
function withCurrencyColumn() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const sheet = wb.sheet(id);
  wb.applyStyle(id, { r1: 0, c1: 1, r2: sheet.rows - 1, c2: 1 }, { fmt: 'currency' });
  // The format is kept on the column itself, so it holds past the rows the sheet has reached, which store
  // no cell at all.
  expect(sheet.colStyles.size).toBe(1);
  expect(wb.getCell(id, 500, 1)).toBeUndefined();
  expect(wb.styleAt(id, 500, 1)).toMatchObject({ fmt: 'currency' });
  return { wb, id };
}

it.each([
  ['=B501+1', '$1.00'],
  ['=B501*2', '$0.00'],
  ['=SUM(B501:B600)', '$0.00'],
])('gives %s the format of the column it reads, past the rows that store a cell', (formula, shown) => {
  const { wb, id } = withCurrencyColumn();
  wb.setInput(id, 0, 0, formula);
  expect(wb.getCell(id, 0, 0).s).toMatchObject({ fmt: 'currency' });
  expect(wb.getDisplay(id, 0, 0)).toBe(shown);
});

it('reads a row format and a column on another sheet the same way', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const sheet = wb.sheet(id);
  wb.applyStyle(id, { r1: 10, c1: 0, r2: 10, c2: sheet.cols - 1 }, { fmt: 'percent', dec: 1 });
  expect(wb.getCell(id, 10, 40)).toBeUndefined();
  wb.setInput(id, 12, 0, '=AO11*2');
  expect(wb.getCell(id, 12, 0).s).toMatchObject({ fmt: 'percent', dec: 1 });
  const other = wb.addSheet('Two');
  wb.applyStyle(other.id, { r1: 0, c1: 0, r2: wb.sheet(other.id).rows - 1, c2: 0 }, { fmt: 'currency', cur: 'EUR' });
  wb.setInput(id, 13, 0, '=Two!A500*2');
  expect(wb.getCell(id, 13, 0).s).toMatchObject({ fmt: 'currency', cur: 'EUR' });
});

it('still carries nothing where the plain reference carries nothing', () => {
  const { wb, id } = withCurrencyColumn();
  wb.setInput(id, 0, 0, '=COUNT(B501:B600)');
  expect(wb.getCell(id, 0, 0).s).toBeUndefined();
  // A cell the user has already formatted keeps what it has.
  wb.applyStyle(id, { r1: 3, c1: 0, r2: 3, c2: 0 }, { fmt: 'percent', dec: 0 });
  wb.setInput(id, 3, 0, '=B501+1');
  expect(wb.getCell(id, 3, 0).s).toMatchObject({ fmt: 'percent' });
});
