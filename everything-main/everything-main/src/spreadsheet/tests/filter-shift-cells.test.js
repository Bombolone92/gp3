import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 2, 2, 'Value');
  wb.setInput(id, 2, 3, 'Result');
  for (let r = 3; r <= 5; r++) {
    wb.setInput(id, r, 2, String(r - 2));
    wb.setInput(id, r, 3, `=C${r + 1}`);
  }
  wb.setFilterRange(id, { r1: 2, c1: 2, r2: 5, c2: 3 });
  wb.setFilterCriteria(id, 3, { values: ['2'] });
  for (let r = 3; r <= 5; r++) wb.getValue(id, r, 3);
  wb.clearHistory();
  return { wb, id };
}

it.each([
  ['insert', 'down', { r1: 1, c1: 2, r2: 1, c2: 3 }, { r1: 3, c1: 2, r2: 6, c2: 3 }, 3],
  ['delete', 'up', { r1: 1, c1: 2, r2: 1, c2: 3 }, { r1: 1, c1: 2, r2: 4, c2: 3 }, 3],
  ['insert', 'right', { r1: 2, c1: 1, r2: 5, c2: 1 }, { r1: 2, c1: 3, r2: 5, c2: 4 }, 4],
  ['delete', 'left', { r1: 2, c1: 1, r2: 5, c2: 1 }, { r1: 2, c1: 1, r2: 5, c2: 2 }, 2],
  ['insert', 'right', { r1: 2, c1: 3, r2: 5, c2: 3 }, { r1: 2, c1: 2, r2: 5, c2: 4 }, 4],
])('%s cells shifting %s keeps filter bounds, criteria, and visible results aligned (%j)', (mode, direction, range, expected, column) => {
  const { wb, id } = setup();
  const before = wb.toJSON();
  expect(wb[`${mode}Cells`](id, range, direction)).toBe(true);
  const check = () => {
    const sheet = wb.sheet(id);
    expect(sheet.filter).toEqual({ range: expected, criteria: { [column]: { values: ['2'], keys: ['2'] } } });
    const visible = [];
    for (let r = expected.r1 + 1; r <= expected.r2; r++) {
      const value = wb.getValue(id, r, column);
      expect(sheet.filterHidden.has(r)).toBe(value !== 2);
      if (!sheet.filterHidden.has(r)) visible.push(value);
    }
    expect(visible).toEqual([2]);
  };
  check();
  const after = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  expect([...wb.sheet(id).filterHidden]).toEqual([3, 5]);
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
  check();
});

it('drops deleted filter criteria and clears hidden rows when the filter is removed', () => {
  const { wb, id } = setup();
  wb.deleteCells(id, { r1: 2, c1: 3, r2: 5, c2: 3 }, 'left');
  expect(wb.sheet(id).filter).toEqual({ range: { r1: 2, c1: 2, r2: 5, c2: 2 }, criteria: {} });
  expect([...wb.sheet(id).filterHidden]).toEqual([]);
  wb.undo();
  wb.deleteCells(id, { r1: 2, c1: 2, r2: 5, c2: 3 }, 'up');
  expect(wb.sheet(id).filter).toBeNull();
  expect([...wb.sheet(id).filterHidden]).toEqual([]);
});
