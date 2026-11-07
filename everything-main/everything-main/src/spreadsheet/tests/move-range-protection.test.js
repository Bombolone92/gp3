import { expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each(['source', 'destination', 'overlap'])('refuses a move with protected %s cells before changing references or metadata', (kind) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10');
  wb.setInput(id, 1, 0, '=A1*2');
  wb.setInput(id, 0, 4, '=A1');
  wb.setNote(id, 0, 0, 'Source note');
  wb.setNote(id, 4, 0, 'Destination note');
  wb.mergeCells(id, { r1: 0, c1: 1, r2: 1, c2: 1 });
  wb.defineName('Source', 'Sheet1!$A$1');
  const other = wb.addSheet('Summary').id;
  wb.setInput(other, 0, 0, '=Sheet1!A1');
  const destination = kind === 'overlap' ? 1 : 4;
  const r = kind === 'source' ? 0 : destination;
  wb.protectRange(id, { r1: r, c1: 0, r2: r, c2: 0 }, 'Keep');
  wb.clearHistory();
  const before = wb.toJSON();
  const events = vi.fn();
  wb.addEventListener('change', events);
  const result = wb.moveRange(id, { r1: 0, c1: 0, r2: 1, c2: 1 }, destination, 0);
  expect(wb.toJSON()).toEqual(before);
  expect(result).toBeNull();
  expect(wb.canUndo()).toBe(false);
  expect(events.mock.calls.some(([event]) => event.detail.type === 'protected')).toBe(true);
});
