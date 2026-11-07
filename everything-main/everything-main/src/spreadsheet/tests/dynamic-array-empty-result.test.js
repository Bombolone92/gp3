import { describe, it, expect } from 'vitest';
import { calc } from './helpers/calc.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, workbookToXlsx } from '../src/core/io.js';

// Desktop Excel displays #CALC! for these empty results; its native save stores
// #VALUE! plus XLRICHVALUE _error metadata (errorType 13, subType 3).
describe('dynamic array functions with empty results', () => {
  it.each([
    'UNIQUE({1;1},FALSE,TRUE)',
    'FILTER({1;2},{FALSE;FALSE})',
    'FILTER({1,2},{FALSE,FALSE})',
    'IFNA(FILTER({1;2},{FALSE;FALSE}),"missing")',
    'UNIQUE({1,1},TRUE,TRUE)',
    'UNIQUE({"x",2;"X",2},FALSE,TRUE)',
    'ROWS(UNIQUE({1;1},FALSE,TRUE))',
    'COLUMNS(UNIQUE({1,1},TRUE,TRUE))',
    'IFNA(UNIQUE({1;1},FALSE,TRUE),"missing")',
  ])('returns the empty-array error from %s', f => expect(calc(f)).toEqual({ error: '#CALC!' }));

  it('distinguishes no results, one result, and no matching lookup', () => {
    expect(calc('IFERROR(UNIQUE({1;1},FALSE,TRUE),"empty")')).toBe('empty');
    expect(calc('INDEX(UNIQUE({1;1;2},FALSE,TRUE),1)')).toBe(2);
    expect(calc('MATCH(2,{1;1},0)')).toEqual({ error: '#N/A' });
  });

  it('updates the spill/error result after editing and undo, and survives XLSX export', async () => {
    const w = new Workbook(), id = w.activeSheetId;
    w.setInput(id, 0, 0, '4'); w.setInput(id, 1, 0, '4');
    w.setInput(id, 0, 2, '=UNIQUE(A1:A2,,TRUE)');
    expect(w.getValue(id, 0, 2)).toEqual({ error: '#CALC!' });
    w.setInput(id, 1, 0, '8');
    expect(w.getValue(id, 0, 2)).toBe(4);
    expect(w.getValue(id, 1, 2)).toBe(8);
    w.undo();
    expect(w.getValue(id, 0, 2)).toEqual({ error: '#CALC!' });
    expect(w.getValue(id, 1, 2)).toBe(null);
    const data = new Uint8Array(await (await workbookToXlsx(w)).arrayBuffer());
    const back = await workbookFromFile(data, 'unique.xlsx');
    expect(back.getValue(back.activeSheetId, 0, 2)).toEqual({ error: '#CALC!' });
  });
});
