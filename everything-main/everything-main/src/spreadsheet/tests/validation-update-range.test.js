import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Editing a rule onto another rule's exact range kept both, and the later one silently won.
it('replaces the rule already on a range when another rule is moved onto it', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const a = wb.addValidation(id, { type: 'list', values: ['x', 'y'], range: { r1: 0, c1: 0, r2: 3, c2: 0 } });
  const b = wb.addValidation(id, { type: 'number', min: 1, max: 9, range: { r1: 0, c1: 1, r2: 3, c2: 1 } });
  expect(wb.updateValidation(id, b, { range: { r1: 0, c1: 0, r2: 3, c2: 0 } })).toBeTruthy();
  expect(wb.sheet(id).validations.map((v) => [v.id, v.type])).toEqual([[b, 'number']]);
  expect(wb.validationAt(id, 2, 0)?.type).toBe('number');
  wb.undo();
  expect(wb.sheet(id).validations.map((v) => v.id).sort()).toEqual([a, b].sort());
});
