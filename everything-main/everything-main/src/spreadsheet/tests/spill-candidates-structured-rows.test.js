import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

function book() {
  const wb = new Workbook(), s = wb.activeSheet;
  [['Left', 'Right'], [3, 5], [7, 11]].forEach((row, r) => row.forEach((v, c) => wb.setInput(s.id, r, c, String(v))));
  wb.addTable(s.id, { r1: 0, c1: 0, r2: 2, c2: 1 }, { name: 'Data' });
  return wb;
}
it.each([
  'Data[@Left]', 'Data[[@Left]]', 'Data[[#This Row],[Left]]', 'Data[[#this row],[Left]]',
  'Data[[#This Row],[Left]:[LEFT]]', 'Data[[#Headers],[Left]]', 'Data[[#Totals],[Right]]',
  'IFERROR(Data[[#This Row],[Left]]*Data[[#This Row],[Right]],0)',
  'IF(ISBLANK(Data[[#This Row],[Left]]),"",Data[[#This Row],[Left]])',
  'LET(x,Data[[#This Row],[Right]],x+1)', 'SUM(Data[@[Left]:[Right]])',
])('recognizes one-cell structured results without dynamic-array metadata: %s', formula => {
  const wb = book(), id = wb.activeSheetId;
  wb.setInput(id, 1, 4, '=' + formula);
  expect(wb.isDynamicArrayFormula(id, 1, 4)).toBe(false);
});
it.each([
  'Data[@[Left]:[Right]]', 'Data[[#This Row],[Left]:[Right]]', 'Data[@]',
  'Data[[#Headers],[Left]:[Right]]', 'Data[[#Totals],[Left]:[Right]]',
  'Data[Left]', 'Data[[#Headers],[#Data],[Left]]', 'Data[[#Data],[#Totals],[Right]]',
  'IFERROR(Data[[#This Row],[Left]:[Right]],0)',
])('retains array discovery for structured ranges: %s', formula => {
  const wb = book(), id = wb.activeSheetId;
  wb.setInput(id, 1, 4, '=' + formula);
  expect(wb.isDynamicArrayFormula(id, 1, 4)).toBe(true);
});
it.each(['Data[@[Left]:[Right]]', 'Data[[#This Row],[Left]:[Right]]'])('discovers horizontal spill followers and recalculates them: %s', formula => {
  const wb = book(), id = wb.activeSheetId;
  wb.setInput(id, 1, 4, '=' + formula);
  // Read the follower first: array discovery must find this anchor.
  expect(wb.getValue(id, 1, 5)).toBe(5);
  expect(wb.getValue(id, 1, 4)).toBe(3);
  wb.setInput(id, 1, 1, '13'); expect(wb.getValue(id, 1, 5)).toBe(13);
  wb.undo(); expect(wb.getValue(id, 1, 5)).toBe(5);
});
