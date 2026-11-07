import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function book() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '=HYPERLINK("https://x.com","Go")');
  wb.setInput(id, 1, 0, '=1+1');
  wb.setInput(id, 2, 0, '=HYPERLINK("#Sheet1!A1","home")');
  wb.setInput(id, 3, 0, '=HYPERLINK("https://y.com")');
  return { wb, id };
}

it('keeps the links in a range when its formulas are replaced with values', () => {
  const { wb, id } = book();
  expect(wb.formulasToValues(id, { r1: 0, c1: 0, r2: 4, c2: 0 })).toBe(1);
  expect(wb.getCell(id, 1, 0)).toMatchObject({ v: 2, f: null });
  expect(wb.getCell(id, 0, 0).f).toBe('HYPERLINK("https://x.com","Go")');
  expect(wb.linkAt(id, 0, 0)).toMatchObject({ label: 'Go' });
  expect(wb.linkAt(id, 0, 0).url).toMatch(/^https:\/\/x\.com/);
  expect(wb.linkAt(id, 2, 0)).toMatchObject({ label: 'home' });
  expect(wb.linkAt(id, 2, 0).url).toMatch(/^#/);
  expect(wb.linkAt(id, 3, 0)?.url).toMatch(/^https:\/\/y\.com/);
});

it('reports nothing replaced, and records no step, when the range holds only links', () => {
  const { wb, id } = book();
  wb.clearHistory();
  const before = wb.toJSON();
  expect(wb.formulasToValues(id, { r1: 0, c1: 0, r2: 0, c2: 0 })).toBe(0);
  expect(wb.toJSON()).toEqual(before);
  expect(wb.canUndo()).toBe(false);
});
