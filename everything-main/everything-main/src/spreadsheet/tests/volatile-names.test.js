import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it('refreshes a workbook whose only volatile formula is a defined name', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.defineName('Fixed', 'Sheet1!$A$1');
  wb.setInput(id, 0, 0, '5');
  wb.setInput(id, 1, 0, '=Fixed');
  expect(wb.hasVolatileFormulas()).toBe(false);
  expect(wb.refreshVolatile()).toBe(false);
  wb.defineName('Now', 'NOW()');
  wb.setInput(id, 2, 0, '=Now');
  expect(typeof wb.getValue(id, 2, 0)).toBe('number');
  expect(wb.hasVolatileFormulas()).toBe(true);
  expect(wb.refreshVolatile()).toBe(true);
  expect(typeof wb.getValue(id, 2, 0)).toBe('number');
});

it('is not thrown off by a name whose formula cannot be read', () => {
  const wb = new Workbook({ sheets: [{ name: 'Sheet1', cells: {} }], names: [{ name: 'Deep', ref: `${'('.repeat(5000)}1${')'.repeat(5000)}` }] });
  expect(() => wb.hasVolatileFormulas()).not.toThrow();
  expect(wb.hasVolatileFormulas()).toBe(false);
});
