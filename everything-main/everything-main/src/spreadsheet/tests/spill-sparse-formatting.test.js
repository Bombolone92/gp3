import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { AUTOMATIC_FORMAT } from '../src/core/format.js';

function book(axis) {
  const wb = new Workbook({ sheets: [{ name: 'Array',
    cells: { '0,0': { f: axis === 'col' ? 'SEQUENCE(2000,2)' : 'SEQUENCE(2,500)', s: { fmt: 'currency', cur: 'USD', dec: 2 } } },
  }] });
  const id = wb.activeSheetId;
  wb.getValue(id, 0, 0);
  const target = axis === 'col' ? { r: 1999, c: 1, value: 4000 } : { r: 1, c: 499, value: 1000 };
  const range = axis === 'col' ? { r1: 0, c1: 1, r2: wb.sheet(id).rows - 1, c2: 1 }
    : { r1: 1, c1: 0, r2: 1, c2: wb.sheet(id).cols - 1 };
  return { wb, id, target, range };
}

it.each(['col', 'row'])('formats spill results beyond stored cells in a whole %s', (axis) => {
  const { wb, id, target: { r, c, value }, range } = book(axis);
  const before = wb.getDisplay(id, r, c);
  expect(before).toContain('$');
  expect(wb.getCell(id, r, c)).toBeUndefined();
  wb.applyStyle(id, range, AUTOMATIC_FORMAT);
  expect(wb.getDisplay(id, r, c)).toBe(String(value));
  expect(wb.getDisplay(id, 0, 0)).toBe('$1.00');
  wb.undo();
  expect(wb.getDisplay(id, r, c)).toBe(before);
  wb.redo();
  expect(wb.getDisplay(id, r, c)).toBe(String(value));
  wb.applyStyle(id, range, { fmt: 'percent', dec: 0 });
  expect(wb.getDisplay(id, r, c)).toBe(axis === 'col' ? '400,000%' : '100,000%');
  expect(wb.getValue(id, r, c)).toBe(value);
});

it('formats spilled data across a large rectangle while preserving skipped rows and staying sparse', () => {
  const { wb, id } = book('col');
  wb.ensureSize(id, 20000, 100);
  const range = { r1: 1, c1: 0, r2: 10000, c2: 50 };
  wb.applyStyle(id, range, { fmt: 'percent', dec: 0 }, { skipRow: (r) => r === 1998 });
  expect(wb.getDisplay(id, 1999, 1)).toBe('400,000%');
  expect(wb.getDisplay(id, 1998, 1)).toBe('$3,998.00');
  expect(wb.getDisplay(id, 0, 0)).toBe('$1.00');
  expect(wb.sheet(id).cells.size).toBeLessThan(10000);
});

it('refuses the entire format when a protected spill result lies beyond the nearby blank cells', () => {
  const { wb, id, range, target: { r, c } } = book('col');
  wb.sheet(id).protectedRanges.push({ id: 'locked', range: { r1: r, c1: c, r2: r, c2: c } });
  wb.applyStyle(id, range, { fmt: 'percent', dec: 0 });
  expect(wb.getDisplay(id, 0, 1)).toBe('$2.00');
  expect(wb.getDisplay(id, r, c)).toBe('$4,000.00');
  expect(wb.canUndo()).toBe(false);
});

it('applies font and fill changes to visible spilled data in a large finite selection', () => {
  const { wb, id } = book('col');
  wb.ensureSize(id, 20000, 100);
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 10000, c2: 50 }, { bold: true, bg: '#ffff00' });
  expect(wb.styleAt(id, 1999, 1)).toMatchObject({ bold: true, bg: '#ffff00' });
  expect(wb.styleAt(id, 0, 0)?.bold).toBeUndefined();
  expect(wb.sheet(id).cells.size).toBeLessThan(10000);
});
