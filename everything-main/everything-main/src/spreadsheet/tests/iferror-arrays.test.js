import { expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { workbookToXlsx, workbookFromFile } from '../src/core/io.js';

function book(formula) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, formula);
  const at = (r, c = 0) => wb.getValue(id, r, c);
  return { wb, id, at };
}

it('replaces each error in an array without losing successful values or its shape', () => {
  const { at } = book('=IFERROR({1,#N/A;#DIV/0!,4},0)');
  expect(at(1, 1)).toBe(4); // Read a spill child before its anchor.
  expect([[at(0, 0), at(0, 1)], [at(1, 0), at(1, 1)]]).toEqual([[1, 0], [0, 4]]);
});

it('IFNA replaces only N/A errors in an array', () => {
  const { at } = book('=IFNA({#N/A,2;#DIV/0!,#N/A},"Missing")');
  expect([[at(0, 0), at(0, 1)], [at(1, 0), at(1, 1)]]).toEqual([
    ['Missing', 2], [{ error: '#DIV/0!' }, 'Missing'],
  ]);
});

it('uses fallback arrays at the corresponding positions', () => {
  const { at } = book('=IFERROR({#N/A,2;3,#DIV/0!},{10,20;30,40})');
  expect([[at(0, 0), at(0, 1)], [at(1, 0), at(1, 1)]]).toEqual([[10, 2], [3, 40]]);
});

it.each(['IFERROR', 'IFNA'])('%s preserves successful arrays and leaves unused fallbacks unevaluated', (fn) => {
  const { wb, id, at } = book(`=${fn}(SEQUENCE(3),A1)`);
  expect([at(0), at(1), at(2)]).toEqual([1, 2, 3]);
  wb.setInput(id, 0, 0, `=SUM(${fn}({1,#N/A,3},0))`);
  expect(at(0)).toBe(4);
});

it('recalculates repaired source cells and preserves results after saving and reopening', async () => {
  const { wb, id, at } = book('=IFERROR(C1:C3,0)');
  wb.setInput(id, 0, 2, '10');
  wb.setInput(id, 1, 2, '=1/0');
  wb.setInput(id, 2, 2, '30');
  expect([at(0), at(1), at(2)]).toEqual([10, 0, 30]);
  wb.setInput(id, 1, 2, '20');
  expect([at(0), at(1), at(2)]).toEqual([10, 20, 30]);
  wb.undo();
  expect([at(0), at(1), at(2)]).toEqual([10, 0, 30]);
  const back = await workbookFromFile(await workbookToXlsx(wb), 'errors.xlsx');
  expect([0, 1, 2].map((r) => back.getValue(back.sheets[0].id, r, 0))).toEqual([10, 0, 30]);
});
