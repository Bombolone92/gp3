import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { tokenize } from '../src/core/formula/tokenizer.js';
import { parseFormula } from '../src/core/formula/parser.js';
import { parseRefText, refToText, shiftFormula } from '../src/core/refs.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

it.each([
  ["'Jan:Mar'!A1", 'Jan', 'Mar'],
  ["'Jan Data:Mar Data'!A1", 'Jan Data', 'Mar Data'],
  ["'Jan''s Data:Mar''s Data'!A1", "Jan's Data", "Mar's Data"],
  ["'一月:三月'!A1", '一月', '三月'],
  ["'Jan:Mar Data'!$A$1:$B$2", 'Jan', 'Mar Data'],
])('parses both sheet endpoints in %s', (formula, sheet, sheetEnd) => {
  expect(tokenize(formula)).toEqual([expect.objectContaining({ sheet, sheetEnd, start: 0, end: formula.length })]);
  expect(parseFormula(formula).ref).toMatchObject({ sheet, sheetEnd });
});

it.each([
  ['Jan', 'Mar Data', "'Jan:Mar Data'!A1"],
  ['Jan Data', 'Mar', "'Jan Data:Mar'!A1"],
  ["Jan's Data", "Mar's Data", "'Jan''s Data:Mar''s Data'!A1"],
  ['Jan', 'Mar', 'Jan:Mar!A1'],
])('serializes %s through %s using quoted sheet-span syntax', (sheet, sheetEnd, expected) => {
  expect(refToText(parseRefText('A1', sheet, sheetEnd))).toBe(expected);
});

it.each(["'Jan:Mar:Apr'!A1", "':Mar'!A1", "'Jan:'!A1", "'Jan:Mar'!A1#"])
  ('rejects malformed spans and unsupported 3-D spills: %s', (formula) => {
    expect(() => parseFormula(formula)).toThrow();
  });

it('preserves ordinary quoted sheets and legacy separately quoted spans', () => {
  expect(parseFormula("'Jan''s Data'!A1").ref).toMatchObject({ sheet: "Jan's Data" });
  expect(parseFormula("'Jan Data':'Mar Data'!A1").ref).toMatchObject({ sheet: 'Jan Data', sheetEnd: 'Mar Data' });
  expect(shiftFormula("SUM('Jan Data:Mar Data'!A1,$B$2)", 1, 2)).toBe("SUM('Jan Data:Mar Data'!C2,$B$2)");
});

it('updates quoted spans and defined names through source edits, renames, insertion, and undo', () => {
  const wb = new Workbook({ sheets: [{ name: 'Jan Data' }, { name: 'Feb' }, { name: "Mar's Data" }, { name: 'Summary' }] });
  const [first, middle, last, summary] = wb.sheets;
  [first, middle, last].forEach((s, i) => wb.setInput(s.id, 0, 0, String(i + 1)));
  wb.setInput(summary.id, 0, 0, "=SUM('Jan Data:Mar''s Data'!A1)");
  wb.defineName('Quarter', "'Jan Data:Mar''s Data'!A1");
  wb.setInput(summary.id, 1, 0, '=SUM(Quarter)');
  expect(wb.getValue(summary.id, 0, 0)).toBe(6);
  expect(wb.getValue(summary.id, 1, 0)).toBe(6);
  wb.setInput(middle.id, 0, 0, '10');
  expect(wb.getValue(summary.id, 0, 0)).toBe(14);
  wb.renameSheet(last.id, 'Q1 End');
  expect(wb.getCell(summary.id, 0, 0).f).toBe("SUM('Jan Data:Q1 End'!A1)");
  expect(wb.getValue(summary.id, 1, 0)).toBe(14);
  wb.insertRows(middle.id, 0, 1);
  expect(wb.getCell(summary.id, 0, 0).f).toBe("SUM('Jan Data:Q1 End'!A2)");
  wb.undo();
  expect(wb.getValue(summary.id, 0, 0)).toBe(14);
});

it('evaluates imported quoted sheet spans after XLSX reopening', async () => {
  let wb = new Workbook({ sheets: [{ name: 'Jan Data' }, { name: 'Mar Data' }, { name: 'Summary' }] });
  wb.setInput(wb.sheets[0].id, 0, 0, '10');
  wb.setInput(wb.sheets[1].id, 0, 0, '20');
  wb.setInput(wb.sheets[2].id, 0, 0, "=SUM('Jan Data:Mar Data'!A1)");
  wb = await workbookFromFile(await workbookToXlsx(wb), 'quoted-span.xlsx');
  expect(wb.getValue(wb.sheets[2].id, 0, 0)).toBe(30);
});
