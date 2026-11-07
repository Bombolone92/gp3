import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The loader gives every table a calc map, empty when it has no calculated columns; a table created in
// the session had none until a column formula was typed, so a book compared with its reloaded self differed.
it('creates a table with an empty calc map, as the loader does, so the book equals its reloaded self', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Name');
  wb.setInput(id, 1, 0, 'a');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 });
  const table = wb.sheet(id).tables[0];
  expect(table.calc).toEqual({});
  const again = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
  expect(again.sheet(id).tables[0]).toEqual(table);
  expect(again.toJSON()).toEqual(wb.toJSON());
});
