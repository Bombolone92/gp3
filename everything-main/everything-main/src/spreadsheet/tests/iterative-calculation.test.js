import { describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { normalizeIteration } from '../src/core/iteration.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';
import { otherProgramsXlsx } from './helpers/xlsx-fixture.js';
import * as X from '../src/vendor/xlsx.mjs';
import { sameBook } from '../src/lib/drafts.js';

function book(cells, options = {}) {
  return new Workbook({ iteration: { iterate: true, iterateDelta: 1e-10, ...options }, sheets: [{ name: 'Model', cells }] });
}
const value = (wb, r = 0, c = 0) => wb.getValue(wb.sheets[0].id, r, c);
const formula = (f, v = null) => ({ f, v });

describe('explicit workbook iterative calculation', () => {
  it('uses OOXML defaults and rejects malformed settings without enabling iteration accidentally', () => {
    for (const iterate of [false, 'false', 0, '0', 'yes', {}, null]) expect(normalizeIteration({ iterate })).toBeNull();
    for (const iterate of [true, 1, '1', 'true']) expect(normalizeIteration({ iterate })).toEqual({ iterate: true, iterateCount: 100, iterateDelta: .001 });
    for (const n of [-1, 0, 2.5, Infinity, NaN, 32768, 2 ** 32]) expect(normalizeIteration({ iterate: true, iterateCount: n }).iterateCount).toBe(100);
    for (const n of [-1, Infinity, 'bad', '', ' ', [], {}, true]) expect(normalizeIteration({ iterate: true, iterateDelta: n }).iterateDelta).toBe(.001);
  });

  it('converges a self reference and recalculates after input edits and undo', () => {
    const wb = book({ '0,0': formula('(A1+B1)/2'), '0,1': { v: 24 } });
    expect(value(wb)).toBeCloseTo(24, 8);
    wb.setInput(wb.activeSheetId, 0, 1, '10');
    expect(value(wb)).toBeCloseTo(10, 8);
    wb.undo();
    expect(value(wb)).toBeCloseTo(24, 8);
  });

  it('honors iteration count, cached initial guesses and maximum change', () => {
    expect(value(book({ '0,0': formula('A1+3', 7) }, { iterateCount: 4 }))).toBe(19);
    expect(value(book({ '0,0': formula('(A1+1)/2') }, { iterateDelta: .2 }))).toBe(.875);
    const wb = book({ '0,0': formula('1-A1') }, { iterateCount: 5 });
    expect(value(wb)).toBe(1);
    wb.recalculate();
    expect(value(wb)).toBe(0);
  });

  it('uses stable sheet and cell order independent of which result the UI reads first', () => {
    for (const first of [0, 1, 2]) {
      const wb = book({ '0,2': formula('SUM(A1:B1)'), '0,1': formula('A1/2'), '0,0': formula('B1+1') }, { iterateCount: 1 });
      value(wb, 0, first);
      expect(wb.rangeValues(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 2 })).toEqual([[1, .5, 1.5]]);
    }
  });

  it('settles cross-sheet references and dependent formulas', () => {
    const wb = new Workbook({ iteration: { iterate: true, iterateDelta: 1e-9 }, sheets: [
      { name: 'One', cells: { '0,0': formula('Two!B2+1'), '0,1': formula('SUM(A1:A1)*3') } },
      { name: 'Two', cells: { '1,1': formula('One!A1/2') } },
    ] });
    expect(value(wb, 0, 1)).toBeCloseTo(6, 7);
    expect(wb.getValue(wb.sheets[1].id, 1, 1)).toBeCloseTo(1, 7);
  });

  it('preserves a latched value through drafts, copied cells, and a sheet exported as a workbook', () => {
    const wb = book({ '0,0': formula('IF(B1,A1,17)', 8), '0,1': { v: false } });
    expect(value(wb)).toBe(17);
    wb.setInput(wb.activeSheetId, 0, 1, 'TRUE');
    expect(value(wb)).toBe(17);
    expect(value(new Workbook(wb.toJSON()))).toBe(17);
    expect(value(wb.sheetToWorkbook(wb.activeSheetId))).toBe(17);
    const cells = wb.copyRange(wb.activeSheetId, { r1: 0, c1: 0, r2: 0, c2: 1 });
    wb.pasteCells(wb.activeSheetId, cells, 2, 0, { r: 0, c: 0 });
    expect(value(wb, 2, 0)).toBe(17);
    expect(wb.getCell(wb.activeSheetId, 2, 0).f).toBe('IF(B3,A3,17)');
  });

  it('handles branches that start and stop reading circular dependencies', () => {
    const wb = book({ '0,0': formula('IF(C1,(B1+8)/2,3)'), '0,1': formula('A1/2'), '0,2': { v: false }, '0,3': formula('A1+B1') });
    expect(value(wb, 0, 3)).toBe(4.5);
    wb.setInput(wb.activeSheetId, 0, 2, 'TRUE');
    expect(value(wb, 0, 3)).toBeCloseTo(8, 8);
    wb.setInput(wb.activeSheetId, 0, 2, 'FALSE');
    expect(value(wb, 0, 3)).toBe(4.5);
  });

  it('updates spilled dependents after the circular calculation settles', () => {
    const wb = book({ '0,0': formula('(A1+1)/2'), '0,2': formula('SEQUENCE(2,1,A1)') });
    expect(value(wb, 1, 2)).toBeCloseTo(2, 8);
    expect(value(wb, 0, 2)).toBeCloseTo(1, 8);
    wb.setInput(wb.activeSheetId, 0, 0, '=(A1+5)/2');
    expect(value(wb, 1, 2)).toBeCloseTo(6, 8);
  });

  it('keeps spill discovery from manufacturing a circular dependency', () => {
    const wb = book({ '0,0': formula('B1+10'), '0,1': formula('LAMBDA(2)()'), '0,3': formula('IFERROR(SEQUENCE(2,1,A1),99)') });
    expect(value(wb)).toBe(12);
    expect(value(wb, 1, 3)).toBe(13);
  });

  it('handles a circular chain deeper than the JavaScript evaluation stack', () => {
    const cells = Object.fromEntries(Array.from({ length: 2000 }, (_, r) => [`${r},0`, formula(r === 1999 ? 'A1/2' : `A${r + 2}+1`)]));
    const wb = book(cells, { iterateCount: 2 });
    expect(value(wb)).toBe(2);
    expect(value(wb, 1999)).toBe(1);
  });

  it('keeps distinct stable iteration states distinct in draft recovery', () => {
    const first = book({ '0,0': { f: 'IF(B1,A1,17)', v: 8 }, '0,1': { v: true } });
    const second = book({ '0,0': { f: 'IF(B1,A1,17)', v: 17 }, '0,1': { v: true } });
    expect(value(first)).toBe(8);
    expect(value(second)).toBe(17);
    expect(sameBook(first.toJSON(), first.toJSON())).toBe(true);
    expect(sameBook(first.toJSON(), second.toJSON())).toBe(false);
  });

  it('does not reevaluate independent nonvolatile formulas on each iteration', () => {
    const wb = book({ '0,0': formula('(A1+1)/2'), '3,3': formula('SUM(3,4)') });
    const contexts = vi.spyOn(wb, '_context');
    expect(value(wb)).toBeCloseTo(1, 8);
    expect(value(wb, 3, 3)).toBe(7);
    expect(contexts.mock.calls.filter(([, r, c]) => r === 3 && c === 3)).toHaveLength(1);
  });

  it('retains real calculation errors and leaves noniterative cycle detection unchanged', () => {
    expect(value(book({ '0,0': formula('A1/0') }))).toEqual({ error: '#DIV/0!' });
    const wb = new Workbook({ sheets: [{ cells: { '0,0': formula('A1+1') } }] });
    expect(value(wb)).toEqual({ error: '#CYCLE!' });
  });

  it('does not iterate reference metadata functions that do not read their own value', () => {
    const wb = book({ '0,0': formula('ROWS(A1:A4)'), '0,1': formula('COLUMNS(A1:C1)') });
    expect(value(wb)).toBe(4);
    expect(value(wb, 0, 1)).toBe(3);
  });

  it('imports native settings and cached guesses, exports native formulas and reopens without metadata', async () => {
    const bytes = otherProgramsXlsx({ sheetXml: { Data: { rows: '<row r="1"><c r="A1"><f>(A1+B1)/2</f><v>8</v></c><c r="B1"><v>20</v></c></row>' } },
      patch: { '/xl/workbook.xml': xml => xml.replace('</workbook>', '<calcPr iterate="1" iterateCount="50" iterateDelta="0.00001"/></workbook>') } });
    const wb = await workbookFromFile(bytes, 'native.xlsx');
    expect(wb.iteration).toEqual({ iterate: true, iterateCount: 50, iterateDelta: .00001 });
    expect(value(wb)).toBeCloseTo(20, 4);
    const saved = new Uint8Array(await (await workbookToXlsx(wb)).arrayBuffer());
    const native = X.read(saved, { type: 'array' });
    expect(native.Workbook.CalcPr).toMatchObject({ iterate: '1', iterateCount: '50', iterateDelta: '0.00001' });
    expect(native.Sheets.Data.A1.f).toBe('(A1+B1)/2');
    expect(native.Sheets.Data.A1.v).toBeCloseTo(20, 4);
    const zip = X.CFB.read(new Uint8Array(saved), { type: 'array' });
    const metaIndex = native.SheetNames.indexOf('_puter_meta') + 1;
    X.CFB.utils.cfb_del(zip, `/xl/worksheets/sheet${metaIndex}.xml`);
    const part = X.CFB.find(zip, '/xl/workbook.xml');
    part.content = new TextEncoder().encode(new TextDecoder().decode(part.content).replace(/<sheet\b[^>]*name="_puter_meta"[^>]*\/>/, ''));
    part.size = part.content.length;
    const reopened = await workbookFromFile(X.CFB.write(zip, { type: 'array', fileType: 'zip' }), 'native-roundtrip.xlsx');
    expect(reopened.iteration).toEqual(wb.iteration);
    expect(value(reopened)).toBeCloseTo(20, 4);
    const draft = new Workbook(wb.toJSON());
    expect(draft.iteration).toEqual(wb.iteration);
    expect(value(draft)).toBeCloseTo(20, 4);
  });

  it('normalizes a cached iterative date from the 1904 system before using it as a starting value', async () => {
    const bytes = otherProgramsXlsx({
      sheetXml: { Data: { rows: '<row r="1"><c r="A1" s="1"><f>IF(B1,A1,0)</f><v>42000</v></c><c r="B1" t="b"><v>1</v></c></row>' } },
      styles: { cellXfs: ['<xf fontId="0" fillId="0" borderId="0" numFmtId="14"/>'] },
      patch: { '/xl/workbook.xml': xml => xml.replace(/<workbookPr\b[^>]*\/>/, '<workbookPr date1904="1"/>').replace('</workbook>', '<calcPr iterate="true"/></workbook>') },
    });
    const wb = await workbookFromFile(bytes, 'epoch.xlsx');
    expect(value(wb)).toBe(43462);
    expect(value(await workbookFromFile(await workbookToXlsx(wb), 'saved.xlsx'))).toBe(43462);
  });
});
