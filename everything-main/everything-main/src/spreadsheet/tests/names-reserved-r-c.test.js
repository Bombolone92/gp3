import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// R and C alone stand for the current row and column in R1C1 notation, so Excel refuses them as names
// and repairs a workbook that carries one; they were accepted here.
it.each(['R', 'C', 'r', 'c'])('refuses %s as a defined name', (name) => {
  const wb = new Workbook();
  expect(wb.validateName(name)).toBe('That looks like a cell reference');
  expect(wb.defineName(name, 'Sheet1!$A$1')).toBe('That looks like a cell reference');
  expect(wb.names).toEqual([]);
});

it('still accepts names that merely begin with R or C', () => {
  const wb = new Workbook();
  for (const name of ['Rate', 'Cost', 'R2D2', 'CR', 'R_1', 'c.x']) expect(wb.validateName(name)).toBeNull();
  expect(wb.validateName('RC')).toBe('That looks like a cell reference');
  expect(wb.validateName('R1C1')).toBe('That looks like a cell reference');
});
