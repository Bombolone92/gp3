import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

it.each([
  // A row just inserted stays in view until the filter next runs; run it so the blank row is judged too.
  ['insert rows', (wb, id) => { wb.insertRows(id, 3); wb.reapplyFilter(id); }],
  ['delete rows', (wb, id) => wb.deleteRows(id, 3)],
  ['insert columns', (wb, id) => wb.insertCols(id, 2)],
  ['delete columns', (wb, id) => wb.deleteCols(id, 1)],
  ['move rows', (wb, id) => wb.moveRows(id, 3, 1, 6)],
  ['move columns', (wb, id) => wb.moveCols(id, 2, 1, 4)],
])('filters the updated formula values after %s, including undo and redo', (_name, action) => {
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
  // Viewing the formula cells fills the same evaluation cache used by the grid.
  for (let r = 3; r <= 5; r++) wb.getValue(id, r, 3);
  wb.clearHistory();
  const before = wb.toJSON();
  const check = () => {
    const sheet = wb.sheet(id);
    const { range, criteria } = sheet.filter;
    const c = Number(Object.keys(criteria)[0]);
    const visible = [];
    for (let r = range.r1 + 1; r <= range.r2; r++) {
      const text = wb.getDisplay(id, r, c);
      expect(sheet.filterHidden.has(r), `row ${r + 1} displaying ${text}`).toBe(text !== '2');
      if (!sheet.filterHidden.has(r)) visible.push(text);
    }
    expect(visible).toEqual(['2']);
  };
  check();
  action(wb, id);
  check();
  const after = wb.toJSON();
  wb.undo();
  expect(wb.toJSON()).toEqual(before);
  check();
  wb.redo();
  expect(wb.toJSON()).toEqual(after);
  check();
});
