import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

/**
 * A rule on one sheet that reads another sheet's data followed that data through Insert, Delete and
 * Move cells whichever way the reference was spelled, but Move rows and Move columns rewrote only the
 * fully absolute form. The two spellings of one rule then disagreed, and the sheet showed two answers
 * for one number.
 */
function book() {
  const wb = new Workbook({ sheets: [
    { name: 'Data', cells: { '1,1': { v: 200, f: null }, '3,1': { v: 10, f: null } } },
    { name: 'View', cells: { '0,0': { v: null, f: 'Data!B2' } },
      rules: [
        { id: 'rel', type: 'formula', value: 'Data!B2>150', range: { r1: 0, c1: 0, r2: 0, c2: 0 }, style: { bold: true } },
        { id: 'abs', type: 'formula', value: 'Data!$B$2>150', range: { r1: 0, c1: 0, r2: 0, c2: 0 }, style: { italic: true } },
      ],
      validations: [{ id: 'v', type: 'formula', source: 'Data!B2>0', range: { r1: 1, c1: 0, r2: 1, c2: 0 } }] },
  ] });
  return { wb, data: wb.sheets[0].id, view: wb.sheets[1].id };
}
const state = (wb, view) => [wb.getCell(view, 0, 0).f, ...wb.sheet(view).rules.map((r) => r.value), wb.sheet(view).validations[0].source];

describe('a cross-sheet rule formula through a structural edit on the sheet it reads', () => {
  it.each([
    ['insert column', (wb, id) => wb.insertCols(id, 0, 1), 'Data!C2', 'Data!$C$2'],
    ['insert row', (wb, id) => wb.insertRows(id, 0, 1), 'Data!B3', 'Data!$B$3'],
    ['move rows', (wb, id) => wb.moveRows(id, 3, 1, 1), 'Data!B3', 'Data!$B$3'],
    ['move columns', (wb, id) => wb.moveCols(id, 1, 1, 4), 'Data!D2', 'Data!$D$2'],
  ])('follows the data through %s, both spellings together', (_name, edit, relative, absolute) => {
    const { wb, data, view } = book();
    edit(wb, data);
    expect(state(wb, view)).toEqual([relative, `${relative}>150`, `${absolute}>150`, `${relative}>0`]);
    // Both rules judge the same number, so the cell cannot be told two things at once.
    expect(wb.getValue(view, 0, 0)).toBe(200);
  });

  it('puts the formulas back on undo and forward again on redo', () => {
    const { wb, data, view } = book();
    wb.moveRows(data, 3, 1, 1);
    expect(wb.undoLabel()).toBe('Move rows');
    wb.undo();
    expect(state(wb, view)).toEqual(['Data!B2', 'Data!B2>150', 'Data!$B$2>150', 'Data!B2>0']);
    wb.redo();
    expect(state(wb, view)).toEqual(['Data!B3', 'Data!B3>150', 'Data!$B$3>150', 'Data!B3>0']);
  });

  it('leaves a reference into the rule\'s own sheet alone, which is read against each of its cells', () => {
    const wb = new Workbook({ sheets: [
      { name: 'Data', cells: { '1,1': { v: 200, f: null }, '3,1': { v: 10, f: null } } },
      { name: 'View', rules: [{ id: 'own', type: 'formula', value: 'B1>0', range: { r1: 0, c1: 0, r2: 5, c2: 0 }, style: { bold: true } }] },
    ] });
    wb.moveRows(wb.sheets[0].id, 3, 1, 1);
    expect(wb.sheets[1].rules[0].value).toBe('B1>0');
  });

  it('keeps a whole-column reference anchored, as the other edits do', () => {
    const wb = new Workbook({ sheets: [
      { name: 'Data', cells: { '1,1': { v: 200, f: null } } },
      { name: 'View', rules: [{ id: 'col', type: 'formula', value: 'SUM(Data!B:B)>0', range: { r1: 0, c1: 0, r2: 0, c2: 0 }, style: { bold: true } }] },
    ] });
    wb.moveRows(wb.sheets[0].id, 3, 1, 1);
    expect(wb.sheets[1].rules[0].value).toBe('SUM(Data!B:B)>0');
  });
});
