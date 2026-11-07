import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };

// The minute timer repaints a sheet only when hasVolatileFormulas() says so, and it looked at cells
// and names alone: a sheet whose only TODAY() sat in a conditional format or validation rule never
// caught up with the clock.
it('counts a conditional format rule that calls TODAY() as volatile', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '2024-01-01');
  expect(wb.hasVolatileFormulas()).toBe(false);
  const rule = wb.addRule(id, { range: A1, type: 'formula', value: '=A1<TODAY()', style: { bold: true } });
  expect(wb.hasVolatileFormulas()).toBe(true);
  expect(wb.refreshVolatile()).toBe(true);
  wb.deleteRule(id, rule);
  expect(wb.hasVolatileFormulas()).toBe(false);
  // A rule of another kind, or one whose formula does not call the clock, is not.
  wb.addRule(id, { range: A1, type: 'gt', value: 5, style: { bold: true } });
  wb.addRule(id, { range: A1, type: 'formula', value: '=A1<B1', style: { bold: true } });
  expect(wb.hasVolatileFormulas()).toBe(false);
});

it('counts a validation rule that calls NOW() as volatile', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.addValidation(id, { range: A1, type: 'formula', source: '=A1<NOW()' });
  expect(wb.hasVolatileFormulas()).toBe(true);
  const other = new Workbook();
  other.addValidation(other.activeSheetId, { range: A1, type: 'formula', source: '=A1<B1' });
  other.addValidation(other.activeSheetId, { range: { r1: 1, c1: 0, r2: 1, c2: 0 }, type: 'list', source: 'a,b' });
  expect(other.hasVolatileFormulas()).toBe(false);
});

it('is not thrown off by a rule whose formula cannot be read', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.addRule(id, { range: A1, type: 'formula', value: '=SUM(', style: { bold: true } });
  wb.addRule(id, { range: A1, type: 'formula', value: '', style: { bold: true } });
  wb.addValidation(id, { range: A1, type: 'formula', source: '=(((' });
  expect(wb.hasVolatileFormulas()).toBe(false);
});
