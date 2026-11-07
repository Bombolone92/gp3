import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { shiftFormula, renameSheetInFormula } from '../src/core/refs.js';
import { renameTableInFormula } from '../src/core/tables.js';
import { fromFileFormula, toFileFormula } from '../src/core/xlfn.js';

function setup(sheet = 'Two Data') {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: sheet }], names: [
    { name: 'Rate', ref: '10' }, { name: 'Rate', ref: '20', sheet },
    { name: 'Calc', ref: 'Rate+A1', sheet }, { name: 'Double', ref: 'LAMBDA(x,x+Rate+A1)', sheet },
    { name: 'Amount', ref: "'" + sheet.replace(/'/g, "''") + "'!$A$1:$A$2", sheet },
    { name: 'SEQUENCE', ref: '42', sheet }, { name: 'SORT', ref: 'LAMBDA(x,x*3)', sheet },
  ] });
  wb.setInput(wb.sheets[0].id, 0, 0, '3');
  wb.setInput(wb.sheets[1].id, 0, 0, '7'); wb.setInput(wb.sheets[1].id, 1, 0, '11');
  const calc = (f) => { wb.setInput(wb.sheets[0].id, 0, 3, `=${f}`); return wb.getValue(wb.sheets[0].id, 0, 3); };
  return { wb, calc };
}

it.each([
  ["'Two Data'!Rate", 20], ["'two data'!rate", 20], ["One!Rate", 10],
  ["'Two Data'!Calc", 27], ["'Two Data'!Double(A1)", 30],
  ["LET(Rate,100,'Two Data'!Rate+Rate)", 120],
  ["LET(Rate,100,'Two Data'!Double(Rate))", 127],
  ["SUM('Two Data'!Amount)", 18], ["ROWS('Two Data'!Amount)", 2],
  ["SUM(INDIRECT(\"'Two Data'!Amount\"))", 18],
  ["'Two Data'!SEQUENCE", 42], ["'Two Data'!SORT(4)", 12],
  ["'Two Data'!Missing", { error: '#NAME?' }], ["Missing!Rate", { error: '#REF!' }],
  ["LET('Two Data'!Rate,3,4)", { error: '#VALUE!' }],
  ["LAMBDA('Two Data'!Rate,3)(4)", { error: '#VALUE!' }],
])('evaluates qualified name expression %s', (formula, expected) => {
  expect(setup().calc(formula)).toEqual(expected);
});

it.each(["O'Brien", 'A!B', '一月', 'A & B', 'A.B'])('handles quoted sheet %s', (sheet) => {
  const { calc } = setup(sheet);
  expect(calc(`'${sheet.replace(/'/g, "''")}'!Rate`)).toBe(20);
});

it.each(['A1', 'JAN1'])('accepts unquoted sheet %s that also looks like a cell', (sheet) => {
  expect(setup(sheet).calc(`${sheet}!Rate`)).toBe(20);
});

it('follows edits, sheet rename/deletion and undo, including qualified uses inside names', () => {
  const { wb, calc } = setup();
  wb.defineName('Total', "SUM('Two Data'!Amount)");
  expect(calc("Total+'Two Data'!Rate")).toBe(38);
  const id = wb.sheets[1].id;
  wb.setInput(id, 0, 0, '17'); expect(wb.getValue(wb.sheets[0].id, 0, 3)).toBe(48);
  wb.renameSheet(id, "O'Brien");
  expect(wb.getCell(wb.sheets[0].id, 0, 3).f).toBe("Total+'O''Brien'!Rate");
  expect(wb.names.find((n) => n.name === 'Total').ref).toBe("SUM('O''Brien'!Amount)");
  expect(wb.getValue(wb.sheets[0].id, 0, 3)).toBe(48);
  wb.deleteSheet(id); expect(wb.getValue(wb.sheets[0].id, 0, 3)).toEqual({ error: '#REF!' });
  wb.undo(); expect(wb.getValue(wb.sheets[0].id, 0, 3)).toBe(48);
});

it('preserves qualified names while shifting other references and renaming tables', () => {
  expect(shiftFormula("SUM('Two Data'!Amount,A1)", 1, 1)).toBe("SUM('Two Data'!Amount,B2)");
  expect(renameTableInFormula("SUM('Two Data'!Sales,Sales)", 'Sales', 'Revenue', true)).toBe("SUM('Two Data'!Sales,Revenue)");
  expect(renameSheetInFormula('"Two!Rate"+Two!Rate+Two!A1', 'Two', 'New Data'))
    .toBe('"Two!Rate"+\'New Data\'!Rate+\'New Data\'!A1');
});

it('does not treat qualified names as native functions or spill markers', () => {
  const f = "'Two Data'!SORT(4)+'Two Data'!ANCHORARRAY(A1)+SUM(B1#)";
  expect(toFileFormula(f)).toBe("'Two Data'!SORT(4)+'Two Data'!ANCHORARRAY(A1)+SUM(_xlfn.ANCHORARRAY(B1))");
  expect(fromFileFormula(toFileFormula(f))).toBe(f);
  expect(fromFileFormula("_xlfn.Data!_xlfn.Value+'Two Data'!_xlfn.Value")).toBe("_xlfn.Data!_xlfn.Value+'Two Data'!_xlfn.Value");
});

it('defines aliases to names in another scope and discovers qualified lambda spills', () => {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two' }], names: [
    { name: 'OnlyHere', ref: '20', sheet: 'Two' }, { name: 'MakeRows', ref: 'LAMBDA(SEQUENCE(3))', sheet: 'Two' },
  ] });
  expect(wb.defineName('Alias', 'Two!OnlyHere')).toBe(null);
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, '=Two!MakeRows()');
  expect(wb.getValue(id, 2, 0)).toBe(3);
  wb.setInput(id, 0, 2, '=Alias'); expect(wb.getValue(id, 0, 2)).toBe(20);
});

it('detects cycles between qualified named formulas', () => {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two' }], names: [
    { name: 'Loop', ref: 'Two!Loop', sheet: 'One' }, { name: 'Loop', ref: 'One!Loop', sheet: 'Two' },
  ] });
  wb.setInput(wb.sheets[0].id, 0, 0, '=One!Loop');
  expect(wb.getValue(wb.sheets[0].id, 0, 0)).toEqual({ error: '#CYCLE!' });
});
