import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { validateTableName } from '../src/core/tables.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

function setup(name) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Value'); wb.setInput(id, 1, 0, '10');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 0 }, { name });
  wb.setInput(id, 0, 3, `=SUM(${name}[Value])`);
  return { wb, id };
}

it.each(['X12345678', 'AB12345678', 'XFD12345678'].flatMap((name) => ['duplicate', 'import', 'replace'].map((action) => ({ name, action }))))
  ('keeps $name a valid table name during $action', ({ name, action }) => {
    const { wb, id } = setup(name);
    let added;
    if (action === 'duplicate') added = wb.duplicateSheet(id);
    else {
      const { wb: source, id: sourceId } = setup(name);
      added = action === 'import' ? wb.importSheets(source)[0] : wb.replaceSheetWith(wb.addSheet('Target').id, source, sourceId);
    }
    const generated = added.tables[0].name;
    expect(validateTableName(generated)).toBeNull();
    expect(generated).not.toBe(name);
    expect(wb.getCell(added.id, 0, 3).f).toBe(`SUM(${generated}[Value])`);
    expect(wb.getValue(added.id, 0, 3)).toBe(10);
    wb.setInput(added.id, 1, 0, '20');
    expect(wb.getValue(added.id, 0, 3)).toBe(20);
    expect(wb.getValue(id, 0, 3)).toBe(10);
  });

it('avoids collisions with defined names after making the base unambiguous', () => {
  const { wb, id } = setup('X12345678');
  wb.defineName('x_2', '=42');
  const copy = wb.duplicateSheet(id);
  expect(copy.tables[0].name).toBe('X_3');
  expect(wb.getValue(copy.id, 0, 3)).toBe(10);
});

it('preserves ordinary numeric table suffixes', () => {
  const { wb, id } = setup('Sales99');
  const copy = wb.duplicateSheet(id);
  expect(copy.tables[0].name).toBe('Sales2');
  expect(wb.getValue(copy.id, 0, 3)).toBe(10);
});

it('reopens renamed tables with functioning structured references', async () => {
  let { wb, id } = setup('X12345678');
  wb.duplicateSheet(id);
  wb = await workbookFromFile(await workbookToXlsx(wb), 'table-reference-name.xlsx');
  for (const sheet of wb.sheets) {
    expect(validateTableName(sheet.tables[0].name)).toBeNull();
    expect(wb.getValue(sheet.id, 0, 3)).toBe(10);
  }
});
