import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { signatureFor } from '../src/core/formula/hints.js';

function arr(formula, cells = {}) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) { const { r, c } = parseCellRef(a1); wb.setInput(id, r, c, text); }
  wb.setInput(id, 0, 9, `=${formula}`);
  const range = wb.spillRangeAt(id, 0, 9) || { r1: 0, c1: 9, r2: 0, c2: 9 };
  return wb.rangeValues(id, range);
}

const NA = { error: '#N/A' };

// Signature: TEXTSPLIT(text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with]).
describe('TEXTSPLIT options', () => {
  it('pads a ragged block with pad_with instead of #N/A', () => {
    expect(arr('TEXTSPLIT("a,b;c",",",";")')).toEqual([['a', 'b'], ['c', NA]]);
    expect(arr('TEXTSPLIT("a,b;c",",",";",TRUE,0,"x")')).toEqual([['a', 'b'], ['c', 'x']]);
    expect(arr('TEXTSPLIT("a,b;c",",",";",,,0)')).toEqual([['a', 'b'], ['c', 0]]);
  });

  it('drops empty pieces, and empty rows, when ignore_empty is TRUE', () => {
    expect(arr('TEXTSPLIT("a,,b",",")')).toEqual([['a', '', 'b']]);
    expect(arr('TEXTSPLIT("a,,b",",",,TRUE)')).toEqual([['a', 'b']]);
    expect(arr('TEXTSPLIT("a;;b",",",";",TRUE)')).toEqual([['a'], ['b']]);
    expect(arr('TEXTSPLIT("a,;b,c",",",";",TRUE)')).toEqual([['a', NA], ['b', 'c']]);
  });

  it('matches delimiters regardless of case when match_mode is 1', () => {
    expect(arr('TEXTSPLIT("aXbxc","x")')).toEqual([['aXb', 'c']]);
    expect(arr('TEXTSPLIT("aXbxc","x",,,1)')).toEqual([['a', 'b', 'c']]);
    expect(arr('TEXTSPLIT("aXbxc","x",,,2)')).toEqual([[{ error: '#VALUE!' }]]);
  });

  it('cuts by any delimiter of an array constant', () => {
    expect(arr('TEXTSPLIT("a,b;c,d",{",",";"})')).toEqual([['a', 'b', 'c', 'd']]);
    expect(arr('TEXTSPLIT("a.b-c",,{".","-"},TRUE)')).toEqual([['a'], ['b'], ['c']]);
    expect(arr('TEXTSPLIT("1,2|3;4",{",","|"},";")')).toEqual([['1', '2', '3'], ['4', NA, NA]]);
    expect(arr('TEXTSPLIT("a<>b<c",{"<>","<"})')).toEqual([['a', 'b', 'c']]);
  });

  it('keeps every piece as text, where SPLIT reads numbers and booleans', () => {
    expect(arr('TEXTSPLIT("1,2,3;4,5,6",",",";")')).toEqual([['1', '2', '3'], ['4', '5', '6']]);
    expect(arr('TEXTSPLIT("TRUE,x",",")')).toEqual([['TRUE', 'x']]);
    expect(arr('SPLIT("1,TRUE,x",",")')).toEqual([[1, true, 'x']]);
  });

  it('advertises the full signature', () => {
    expect(signatureFor('TEXTSPLIT').params).toBe('text, col_delimiter, [row_delimiter], [ignore_empty], [match_mode], [pad_with]');
  });
});
