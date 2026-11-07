// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { placeImport } from '../src/ui/importdialog.js';

/** A file with two sheets whose Data sheet leans on the other one in several ways. */
function source() {
  const other = new Workbook({ sheets: [{ name: 'Sheet1' }, { name: 'Data' }] });
  const [first, data] = other.sheets;
  other.setInput(first.id, 0, 0, '5');
  other.setInput(data.id, 0, 0, '=Sheet1!A1*2'); // another sheet of the file: 10
  other.setInput(data.id, 0, 1, '=Data!A1+1'); // its own sheet by name: 11
  other.setInput(data.id, 0, 2, '=A1+A2'); // its own sheet: 17
  other.setInput(data.id, 1, 0, '7');
  other.setInput(data.id, 1, 1, '=SUM(Sheet1:Data!A1)'); // a span over both sheets: 15
  other.setInput(data.id, 1, 2, '=1/Sheet1!B1'); // another sheet, in error
  return other;
}

function destination() {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'Existing');
  return wb;
}

function expectBlock(wb, id, r0, c0) {
  const at = (r, c) => wb.getCell(id, r0 + r, c0 + c);
  const value = (r, c) => wb.getValue(id, r0 + r, c0 + c);
  // What depended on other sheets of the file arrives as the values it showed there.
  expect(at(0, 0)).toMatchObject({ v: 10, f: null });
  expect(at(1, 1)).toMatchObject({ v: 15, f: null });
  expect(value(1, 2)).toEqual({ error: '#DIV/0!' });
  expect(at(1, 2).f).toBeNull();
  // What stayed within the sheet is still a formula, following the block.
  expect(at(0, 1).f).not.toBeNull();
  expect(value(0, 1)).toBe(11);
  expect(at(0, 2).f).not.toBeNull();
  expect(value(0, 2)).toBe(17);
  expect(value(1, 0)).toBe(7);
}

it('places imported cells at a cell as values where they reached into other sheets of the file', () => {
  const wb = destination();
  const other = source();
  const done = placeImport(wb, wb.activeSheetId, other, { mode: 'cell', otherSheetId: other.sheets[1].id, at: { r: 5, c: 2 } });
  expect(done).toMatch(/^Imported 2 rows at C6$/);
  expectBlock(wb, wb.activeSheetId, 5, 2);
  expect(wb.getValue(wb.activeSheetId, 0, 0)).toBe('Existing');
});

it('appends imported rows the same way', () => {
  const wb = destination();
  const other = source();
  const done = placeImport(wb, wb.activeSheetId, other, { mode: 'append', otherSheetId: other.sheets[1].id });
  expect(done).toMatch(/^Appended 2 rows/);
  expectBlock(wb, wb.activeSheetId, 1, 0);
});

it('replaces the current sheet the same way, keeping references into the sheet itself', () => {
  const wb = destination();
  const other = source();
  const done = placeImport(wb, wb.activeSheetId, other, { mode: 'replace', otherSheetId: other.sheets[1].id });
  expect(done).toMatch(/^Replaced the contents of/);
  expectBlock(wb, wb.activeSheetId, 0, 0);
});

it('still brings whole sheets in with their formulas, renamed to the sheets as added', () => {
  const wb = destination();
  const other = source();
  const before = other.toJSON();
  expect(placeImport(wb, wb.activeSheetId, other, { mode: 'sheets' })).toBe('Added 2 sheets');
  const data = wb.sheetByName('Data');
  expect(wb.getCell(data.id, 0, 0).f).toBe("'Sheet1 (2)'!A1*2");
  expect(wb.getValue(data.id, 0, 0)).toBe(10);
  expect(wb.getValue(data.id, 1, 1)).toBe(15);
  // Placing never rewrites the file's own workbook.
  expect(other.toJSON()).toEqual(before);
});

it('leaves the imported workbook as it was after placing part of it', () => {
  const wb = destination();
  const other = source();
  const before = other.toJSON();
  placeImport(wb, wb.activeSheetId, other, { mode: 'cell', otherSheetId: other.sheets[1].id, at: { r: 0, c: 4 } });
  expect(other.toJSON()).toEqual(before);
});

it.each(['sheet', 'range'].flatMap((protection) => ['cell', 'append', 'replace'].map((mode) => [protection, mode])))
  ('detaches formulas from a source with %s protection in %s placement', (protection, mode) => {
    const wb = destination();
    const id = wb.activeSheetId;
    const other = source();
    const data = other.sheets[1];
    if (protection === 'sheet') other.setSheetProtected(data.id, true);
    else other.protectRange(data.id, { r1: 0, c1: 0, r2: 1, c2: 2 }, 'Imported calculations');
    const before = other.toJSON();
    const original = wb.toJSON();
    wb.clearHistory();

    expect(placeImport(wb, id, other, { mode, otherSheetId: data.id, at: { r: 5, c: 2 } })).toBeTruthy();
    const [r, c] = mode === 'cell' ? [5, 2] : mode === 'append' ? [1, 0] : [0, 0];
    expectBlock(wb, id, r, c);
    expect(other.toJSON()).toEqual(before);
    if (mode === 'replace') {
      expect(wb.isProtected(id)).toBe(protection === 'sheet');
      expect(wb.protectedRangeAt(id, 0, 0)?.description).toBe(protection === 'range' ? 'Imported calculations' : undefined);
    }
    // Sheet protection is a live switch: undo restores content while retaining that switch.
    if (mode === 'replace' && protection === 'sheet') original.sheets[0].protected = true;
    wb.undo();
    expect(wb.toJSON()).toEqual(original);
    wb.redo();
    expectBlock(wb, id, r, c);
  });

it('materializes every imported spill value even when the source spill is protected', () => {
  const other = new Workbook({ sheets: [{ name: 'Values' }, { name: 'Data' }] });
  const [values, data] = other.sheets;
  other.setInput(values.id, 0, 0, '5');
  other.setInput(values.id, 1, 0, '9');
  other.setInput(data.id, 0, 0, '=Values!A1:A2');
  other.protectRange(data.id, { r1: 1, c1: 0, r2: 1, c2: 0 }, 'Spilled value');
  const before = other.toJSON();
  const wb = destination();
  const id = wb.activeSheetId;
  expect(placeImport(wb, id, other, { mode: 'cell', otherSheetId: data.id, at: { r: 2, c: 0 } })).toBe('Imported 2 rows at A3');
  expect(wb.getCell(id, 2, 0)).toMatchObject({ v: 5, f: null });
  expect(wb.getCell(id, 3, 0)).toMatchObject({ v: 9, f: null });
  expect(other.toJSON()).toEqual(before);
});
