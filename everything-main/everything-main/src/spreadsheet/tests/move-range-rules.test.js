import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function sheetWithRules() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  for (let r = 0; r < 3; r++) wb.setInput(id, r, 0, String(r + 1));
  wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 2, c2: 0 }, type: 'list', source: 'a,b,c', strict: true });
  wb.addRule(id, { range: { r1: 0, c1: 0, r2: 2, c2: 0 }, type: 'gt', value: 1, style: { bg: '#ffeeaa' } });
  wb.addRule(id, { range: { r1: 5, c1: 5, r2: 5, c2: 5 }, type: 'formula', value: '=A1>1', style: { bold: true } });
  wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 2, c2: 0 }, anchor: { r: 6, c: 6 }, width: 200, height: 120 });
  wb.clearHistory();
  return { wb, id };
}

it('moves validation, conditional formatting, and chart sources with the dragged block', () => {
  const { wb, id } = sheetWithRules();
  expect(wb.moveRange(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, 0, 3)).toEqual({ r1: 0, c1: 3, r2: 2, c2: 3 });
  expect(wb.validationAt(id, 0, 3)?.type).toBe('list');
  expect(wb.validationAt(id, 0, 0)).toBeFalsy();
  expect(wb.sheet(id).rules[0].range).toEqual({ r1: 0, c1: 3, r2: 2, c2: 3 });
  expect(wb.conditionalStyle(id, 1, 3, 2)?.bg).toBe('#ffeeaa');
  expect(wb.conditionalStyle(id, 1, 0, 2)?.bg).toBeUndefined();
  expect(wb.sheet(id).charts[0].range).toEqual({ r1: 0, c1: 3, r2: 2, c2: 3 });
  // A rule elsewhere that read the moved cells follows them.
  expect(wb.sheet(id).rules[1].value).toBe('=D1>1');
  wb.undo();
  expect(wb.validationAt(id, 0, 0)?.type).toBe('list');
  expect(wb.sheet(id).rules[0].range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
  expect(wb.sheet(id).rules[1].value).toBe('=A1>1');
  expect(wb.sheet(id).charts[0].range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 0 });
  expect(wb.undoLabels()).toEqual([]);
});

it('moves the overlapping conditional-format piece while retaining outside rules', () => {
  const { wb, id } = sheetWithRules();
  wb.moveRange(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, 0, 3);
  expect(wb.sheet(id).rules[0].range).toEqual({ r1: 0, c1: 3, r2: 0, c2: 3 });
  expect(wb.sheet(id).rules[1].range).toEqual({ r1: 1, c1: 0, r2: 2, c2: 0 });
  expect(wb.conditionalStyle(id, 1, 0, 2)?.bg).toBe('#ffeeaa');
  expect(wb.conditionalStyle(id, 0, 0, 2)).toBeNull();
  expect(wb.validationAt(id, 1, 0)?.type).toBe('list');
});
