import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { FUNCTIONS } from '../src/core/formula/functions.js';

it.each([
  'INDIRECT("Sheet1:Sheet2!A1")', 'INDIRECT("Sheet1:Sheet2!A1:B2")',
  'INDIRECT("\'Sheet1\':\'Sheet2\'!A1")', 'INDIRECT("\'Sheet1:Sheet2\'!A1")',
  'INDIRECT("Sheet1:Sheet2!R1C1",FALSE)', 'INDIRECT("Across")', 'INDIRECT("Across",FALSE)',
])('rejects unsupported 3-D references in %s', (formula) => {
  const wb = new Workbook(), id = wb.activeSheetId, other = wb.addSheet('Sheet2').id;
  wb.setInput(id, 0, 0, '10'); wb.setInput(other, 0, 0, '20');
  wb.defineName('Across', 'Sheet1:Sheet2!A1');
  wb.setInput(id, 5, 5, `=SUM(${formula})`);
  expect(wb.getValue(id, 5, 5)).toEqual({ error: '#REF!' });
});

it('rejects a sheet span before reading cells', () => {
  const getValue = vi.fn(() => 10), getRangeValues = vi.fn(() => [[10]]);
  expect(FUNCTIONS.INDIRECT.fn(['Sheet1:Sheet2!A1'], { sheetExists: () => true, getValue, getRangeValues }))
    .toEqual({ error: '#REF!' });
  expect(getValue).not.toHaveBeenCalled();
  expect(getRangeValues).not.toHaveBeenCalled();
});

it('keeps supported single-sheet references and direct 3-D aggregates working', () => {
  const wb = new Workbook(), id = wb.activeSheetId, other = wb.addSheet('Source Data').id;
  wb.setInput(id, 0, 0, '10'); wb.setInput(other, 0, 0, '20');
  wb.defineName('SourceCell', "'Source Data'!A1");
  for (const formula of ['INDIRECT("\'Source Data\'!A1")', 'INDIRECT("SourceCell")', 'INDIRECT("\'Source Data\'!R1C1",FALSE)']) {
    wb.setInput(id, 5, 5, `=${formula}`);
    expect(wb.getValue(id, 5, 5)).toBe(20);
  }
  wb.setInput(id, 5, 5, "=SUM(Sheet1:'Source Data'!A1)");
  expect(wb.getValue(id, 5, 5)).toBe(30);
});
