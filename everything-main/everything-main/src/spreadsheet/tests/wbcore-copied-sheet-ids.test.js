import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';

const T = parseRange('A1:A2');

/** A sheet holding one of everything that carries an id, as it stands once saved and opened again. */
function furnished() {
  const built = new Workbook();
  const id = built.activeSheetId;
  built.setCells(id, [{ r: 0, c: 0, cell: { v: 'H', f: null } }, { r: 1, c: 0, cell: { v: 1, f: null } }, { r: 0, c: 2, cell: { v: 5, f: null } }]);
  built.addTable(id, T, { name: 'Items' });
  built.addChart(id, { type: 'bar', range: parseRange('C1:C1'), anchor: { r: 4, c: 0 } });
  built.addRule(id, { type: 'gt', range: parseRange('C1:C1'), value: 3, style: { bold: true } });
  built.addValidation(id, { type: 'number', range: parseRange('C1:C1') });
  built.protectRange(id, parseRange('E5:E5'), 'kept');
  return { wb: new Workbook(built.toJSON()), id };
}

const ids = (sheet) => ['tables', 'charts', 'rules', 'validations', 'protectedRanges'].map((key) => sheet[key].map((x) => x.id));

/** Every id of the copy is new, and every list is as long as the original's. */
function expectFreshIds(original, copy) {
  const before = ids(original);
  const after = ids(copy);
  after.forEach((list, i) => {
    expect(list).toHaveLength(before[i].length);
    expect(list.length).toBeGreaterThan(0);
    for (const x of list) expect(before[i]).not.toContain(x);
  });
}

// A table, chart, rule, validation, or protected range is told apart by its id; a copy that
// keeps the original's ids lets a cut table land on its twin unrefused, and can misdirect
// an edit at whichever of the two is found first.
describe('the ids of a copied sheet\'s objects', () => {
  it('are new on a duplicated sheet, and undo and redo bring back the same workbook', () => {
    const { wb, id } = furnished();
    const before = wb.toJSON();
    const copy = wb.duplicateSheet(id);
    expectFreshIds(wb.sheet(id), copy);
    const after = wb.toJSON();
    wb.undo();
    expect(wb.toJSON()).toEqual(before);
    wb.redo();
    expect(wb.toJSON()).toEqual(after);
  });

  it('are new on an imported sheet, even one copied out of this workbook', () => {
    const { wb, id } = furnished();
    const [added] = wb.importSheets(wb.sheetToWorkbook(id));
    expectFreshIds(wb.sheet(id), added);
    const after = wb.toJSON();
    wb.undo();
    expect(wb.sheets).toHaveLength(1);
    wb.redo();
    expect(wb.toJSON()).toEqual(after);
  });

  it('are new on a sheet replaced with a copy of another', () => {
    const { wb, id } = furnished();
    const other = wb.addSheet('Other').id;
    const replaced = wb.replaceSheetWith(other, wb, id);
    expectFreshIds(wb.sheet(id), replaced);
    const after = wb.toJSON();
    wb.undo();
    expect(wb.sheet(other).tables).toHaveLength(0);
    wb.redo();
    expect(wb.toJSON()).toEqual(after);
  });

  it('keep a table cut from the original from landing on the copy\'s table', () => {
    const { wb, id } = furnished();
    const copy = wb.duplicateSheet(id);
    const before = wb.toJSON();
    expect(wb.placeMoved(copy.id, 0, 0, wb.copyRange(id, T), { sheetId: id, range: T })).toBeNull();
    expect(wb.toJSON()).toEqual(before);
    expect(copy.tables).toHaveLength(1);
    expect(wb.sheet(id).tables).toHaveLength(1);
    // Beside the copy's table the cut table lands as usual.
    expect(wb.placeMoved(copy.id, 0, 4, wb.copyRange(id, T), { sheetId: id, range: T })).toEqual({ r1: 0, c1: 4, r2: 1, c2: 4 });
    expect(copy.tables.map((t) => t.name).sort()).toEqual(['Items', 'Items2']);
    expect(wb.sheet(id).tables).toHaveLength(0);
  });
});
