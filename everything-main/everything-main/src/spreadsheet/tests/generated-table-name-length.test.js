import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { validateTableName } from '../src/core/tables.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

const longName = (length) => 'LongTable' + 'x'.repeat(length - 9);
function setup(name) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name });
  wb.setInput(id, 0, 3, `=SUM(${name}[Value])`);
  return { wb, id };
}

it.each([253, 254, 255])('keeps duplicated %i-character names valid and references live', (length) => {
  const name = longName(length), { wb, id } = setup(name);
  const copy = wb.duplicateSheet(id), generated = copy.tables[0].name;
  expect(generated).not.toBe(name);
  expect(generated.length).toBeLessThanOrEqual(255);
  expect(validateTableName(generated)).toBeNull();
  expect(wb.getCell(copy.id, 0, 3).f).toBe(`SUM(${generated}[Value])`);
  expect(wb.getValue(copy.id, 0, 3)).toBe(10);
  wb.setInput(copy.id, 1, 0, '20');
  expect(wb.getValue(copy.id, 0, 3)).toBe(20);
  expect(wb.getValue(id, 0, 3)).toBe(10);
});

it('leaves room for multi-digit suffixes and avoids case-insensitive defined-name collisions', () => {
  const name = longName(255), { wb, id } = setup(name);
  for (let n = 2; n < 10; n++) wb.defineName(name.slice(0, 254).toUpperCase() + n, '=42');
  const copy = wb.duplicateSheet(id), generated = copy.tables[0].name;
  expect(generated).toBe(name.slice(0, 253) + '10');
  expect(validateTableName(generated)).toBeNull();
  expect(wb.getValue(copy.id, 0, 3)).toBe(10);
});

it.each(['import', 'replace'])('bounds colliding table names during %s and supports undo', (action) => {
  const name = longName(255), { wb, id } = setup(name);
  const { wb: source, id: sourceId } = setup(name);
  const target = wb.addSheet('Target').id;
  wb.clearHistory();
  const before = wb.toJSON();
  const added = action === 'import' ? wb.importSheets(source)[0] : wb.replaceSheetWith(target, source, sourceId);
  const generated = added.tables[0].name;
  expect(generated).toBe(name.slice(0, 254) + '2');
  expect(validateTableName(generated)).toBeNull();
  expect(wb.getValue(added.id, 0, 3)).toBe(10);
  expect(wb.tablesOn(id)[0].name).toBe(name);
  wb.undo();
  expect(wb.toJSON()).toEqual(new Workbook(before).toJSON());
});

it('keeps names and structured references valid after XLSX reopening', async () => {
  const name = longName(255);
  let { wb, id } = setup(name);
  wb.duplicateSheet(id);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'long-table.xlsx');
  expect(wb.tableNames()).toHaveLength(2);
  for (const sheet of wb.sheets) {
    expect(validateTableName(sheet.tables[0].name)).toBeNull();
    expect(wb.getValue(sheet.id, 0, 3)).toBe(10);
  }
});
