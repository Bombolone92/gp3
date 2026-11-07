import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// Deleting a sheet deleted the defined names that pointed at it, so =SUM(Sales) showed #NAME? ("SALES
// is not a named range" for a name the user defined a minute ago), =N showed #CALC! when N spelled a
// function, and the names were gone from the dialog. The name is now kept with =#REF! as its body,
// as cell references to the sheet are kept as #REF!A1, so every dependent shows #REF!.

const REF = { error: '#REF!' };

function setup() {
  const wb = new Workbook();
  const one = wb.activeSheetId;
  const data = wb.addSheet('Data').id;
  [10, 20, 30].forEach((v, r) => wb.setInput(data, r, 0, String(v)));
  wb.setInput(data, 0, 1, '5');
  expect(wb.defineName('Sales', 'Data!$A$1:$A$3')).toBeNull();
  expect(wb.defineName('Pct', '0.5')).toBeNull();
  expect(wb.defineName('Total', 'SUM(Sales)*Pct')).toBeNull();
  expect(wb.defineName('N', 'Data!$B$1')).toBeNull(); // spells a function
  expect(wb.defineName('Local', 'Data!$A$1', 'Data')).toBeNull(); // scoped to the sheet
  expect(wb.defineName('Mixed', 'Sheet1!$A$9+Data!$A$1')).toBeNull();
  wb.setInput(one, 8, 0, '1');
  wb.setInput(one, 0, 0, '=SUM(Sales)');
  wb.setInput(one, 0, 1, '=Total');
  wb.setInput(one, 0, 2, '=Sales');
  wb.setInput(one, 0, 3, '=N');
  wb.setInput(one, 0, 4, '=Mixed');
  wb.setInput(one, 0, 5, '=IFERROR(SUM(Sales),"gone")');
  const values = () => [0, 1, 2, 3, 4, 5].map((c) => wb.getValue(one, 0, c));
  expect(values()).toEqual([60, 30, 10, 5, 11, 60]);
  wb.clearHistory();
  return { wb, one, data, values };
}

describe('deleting a sheet that defined names point at', () => {
  it('keeps the names with a #REF! reference, removing only those scoped to the sheet', () => {
    const { wb, data, values } = setup();
    expect(wb.deleteSheet(data)).toBe(true);
    expect(wb.names.map((n) => [n.name, n.ref, n.sheet ?? null])).toEqual([
      ['Mixed', 'Sheet1!$A$9+#REF!$A$1', null], ['N', '#REF!', null], ['Pct', '0.5', null], ['Sales', '#REF!', null], ['Total', 'SUM(Sales)*Pct', null],
    ]);
    expect(values()).toEqual([REF, REF, REF, REF, REF, 'gone']);
    // The names are still the user's: listed, and defined again over the cells that remain.
    expect(wb.namedEntry('Sales', 'Sheet1')).toMatchObject({ name: 'Sales', ref: '#REF!' });
    expect(wb.defineName('Sales', 'Sheet1!$A$9')).toBeNull();
    expect(values().slice(0, 3)).toEqual([1, 0.5, 1]);
  });

  it('is undone and redone symmetrically', () => {
    const { wb, data, values } = setup();
    const before = wb.names.map((n) => ({ ...n }));
    wb.deleteSheet(data);
    wb.undo();
    expect(wb.names).toEqual(before);
    expect(values()).toEqual([60, 30, 10, 5, 11, 60]);
    wb.redo();
    expect(wb.names.map((n) => n.name)).toEqual(['Mixed', 'N', 'Pct', 'Sales', 'Total']);
    expect(values()).toEqual([REF, REF, REF, REF, REF, 'gone']);
    wb.undo();
    expect(wb.names).toEqual(before);
    expect(values()).toEqual([60, 30, 10, 5, 11, 60]);
  });

  it('does not let a later sheet of the same name take the names over', () => {
    const { wb, data, values } = setup();
    wb.deleteSheet(data);
    const again = wb.addSheet('Data').id;
    wb.setInput(again, 0, 0, '99');
    expect(values().slice(0, 4)).toEqual([REF, REF, REF, REF]);
  });

  it('survives a JSON round trip', () => {
    const { wb, data } = setup();
    wb.deleteSheet(data);
    const back = new Workbook(wb.toJSON());
    expect(back.names.find((n) => n.name === 'Sales')?.ref).toBe('#REF!');
    expect(back.getValue(back.sheets[0].id, 0, 0)).toEqual(REF);
  });
});
