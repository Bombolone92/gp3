import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Redefining a name kept its first spelling, so changing only the case of a name did nothing.
it('takes the newly typed spelling of a name that differs only in case', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const sheetName = wb.sheet(id).name;
  wb.setInput(id, 0, 0, '5');
  wb.setInput(id, 1, 0, '=sales*2');
  expect(wb.defineName('sales', `${sheetName}!$A$1`)).toBeNull();
  expect(wb.renameName('sales', null, 'Sales', `${sheetName}!$A$1`)).toBeNull();
  expect(wb.names.map((n) => n.name)).toEqual(['Sales']);
  expect(wb.getValue(id, 1, 0)).toBe(10);
  expect(wb.undoLabel()).toBe('Define name');
  wb.undo();
  expect(wb.names.map((n) => n.name)).toEqual(['sales']);
  expect(wb.defineName('SALES', `${sheetName}!$A$1`)).toBeNull();
  expect(wb.names.map((n) => n.name)).toEqual(['SALES']);
  // Saving a name exactly as it is still records nothing.
  const steps = wb._history.length;
  expect(wb.defineName('SALES', `${sheetName}!$A$1`)).toBeNull();
  expect(wb._history.length).toBe(steps);
});
