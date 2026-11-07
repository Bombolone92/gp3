import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each([1, -1])('keeps a converged solution when rounding would miss goal %s', (goal) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '1000000000000');
  wb.setInput(id, 0, 1, '=A1-1000000000000');
  wb.clearHistory();
  const found = wb.goalSeek(id, { r: 0, c: 1 }, goal, { r: 0, c: 0 });
  expect(found.ok).toBe(true);
  expect(found.result).toBe(goal);
  expect(found.value).toBe(1000000000000 + goal);
  expect(wb.undoLabels()).toHaveLength(1);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(1000000000000);
  expect(wb.getValue(id, 0, 1)).toBe(0);
  wb.redo();
  expect(wb.getValue(id, 0, 1)).toBe(goal);
});

it.each([1e-20, -1e-20])('keeps a nonzero goal-seek solution starting from %s', (start) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, String(start));
  wb.setInput(id, 0, 1, '=A1*1e20');
  wb.clearHistory();
  const goal = Math.sign(start) * 2;
  const found = wb.goalSeek(id, { r: 0, c: 1 }, goal, { r: 0, c: 0 });
  expect(found.ok).toBe(true);
  expect(found.result).toBeCloseTo(goal, 9);
  expect(found.value).not.toBe(0);
  wb.undo();
  expect(wb.getValue(id, 0, 0)).toBe(start);
  wb.redo();
  expect(wb.getValue(id, 0, 1)).toBeCloseTo(goal, 9);
});
