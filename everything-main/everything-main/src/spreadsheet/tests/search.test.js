import { describe, it, expect } from 'vitest';
import { findAllSheets, replaceInText, cellMatches, compilePattern } from '../src/core/search.js';
import { Workbook as WB2 } from '../src/core/workbook.js';

describe('findAllSheets', () => {
  it('walks every sheet starting from the given one, tagging matches', () => {
    const wb = new WB2({ sheets: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    const [a, b, c] = wb.sheets;
    wb.setInput(a.id, 0, 0, 'rent');
    wb.setInput(b.id, 2, 1, 'Rent due');
    wb.setInput(c.id, 1, 0, 'RENT');
    wb.setInput(c.id, 0, 0, 'other');
    const all = findAllSheets(wb, 'rent', {}, b.id);
    expect(all).toEqual([{ sheetId: b.id, r: 2, c: 1 }, { sheetId: c.id, r: 1, c: 0 }, { sheetId: a.id, r: 0, c: 0 }]);
    expect(findAllSheets(wb, 'rent', { wholeCell: true }, a.id).map((m) => m.sheetId)).toEqual([a.id, c.id]);
    expect(findAllSheets(wb, 'zzz')).toEqual([]);
  });

  it('accepts regular expressions that only Unicode mode rejects, and still refuses broken ones', () => {
    for (const p of ['\\-', 'a{', '\\d{2,', '{}', 'a]', '\\_', '\\@', '\\ ', '\\1', '[a-\\d]']) expect(compilePattern(p)).toBeInstanceOf(RegExp);
    expect(compilePattern('a{').test('see a{')).toBe(true);
    expect(compilePattern('\\-').test('x-y')).toBe(true);
    expect(compilePattern('\\d{2,', { wholeCell: true }).test('1{2,')).toBe(true);
    expect(compilePattern('é').test('CAFÉ')).toBe(true);
    expect(compilePattern('Tar(')).toBeNull();
    expect(compilePattern('[')).toBeNull();
    expect(compilePattern('(a+)+')).toBeNull();
  });

  it('skips hidden sheets, whose matches could not be shown without unhiding them', () => {
    const wb = new WB2({ sheets: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] });
    const [a, b, c] = wb.sheets;
    for (const s of [a, b, c]) wb.setInput(s.id, 0, 0, 'rent');
    wb.setSheetHidden(b.id, true);
    expect(findAllSheets(wb, 'rent', {}, a.id).map((m) => m.sheetId)).toEqual([a.id, c.id]);
    wb.setSheetHidden(b.id, false);
    expect(findAllSheets(wb, 'rent', {}, a.id).map((m) => m.sheetId)).toEqual([a.id, b.id, c.id]);
  });
});
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { findAll, nextIndex, replaceInText, replaceCells, cellMatches } from '../src/core/search.js';

function book(cells) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, text);
  }
  return { wb, id, val: (a1) => { const { r, c } = parseCellRef(a1); return wb.getValue(id, r, c); }, cell: (a1) => { const { r, c } = parseCellRef(a1); return wb.getCell(id, r, c); } };
}

const DATA = { A1: 'Rent', B1: '1500', A2: 'rental car', B2: '=B1*2', A3: 'Food', C5: '=SUM(B1:B2)', D1: '12%' };

describe('findAll', () => {
  it('matches displayed text case-insensitively in reading order', () => {
    const { wb, id } = book(DATA);
    expect(findAll(wb, id, 'rent')).toEqual([{ r: 0, c: 0 }, { r: 1, c: 0 }]);
    expect(findAll(wb, id, 'Rent', { matchCase: true })).toEqual([{ r: 0, c: 0 }]);
    expect(findAll(wb, id, 'rent', { wholeCell: true })).toEqual([{ r: 0, c: 0 }]);
  });

  it('matches numbers as displayed and formulas as text', () => {
    const { wb, id } = book(DATA);
    expect(findAll(wb, id, '3000')).toEqual([{ r: 1, c: 1 }]); // computed value
    expect(findAll(wb, id, 'SUM')).toEqual([{ r: 4, c: 2 }]);
    expect(findAll(wb, id, 'SUM', { formulas: false })).toEqual([]);
    expect(findAll(wb, id, '12%')).toEqual([{ r: 0, c: 3 }]);
    expect(findAll(wb, id, '')).toEqual([]);
  });

  it('walks matches forward and backward with wrap-around', () => {
    const matches = [{ r: 0, c: 0 }, { r: 1, c: 0 }, { r: 4, c: 2 }];
    expect(nextIndex(matches, { r: 0, c: 0 }, 1)).toBe(1);
    expect(nextIndex(matches, { r: 4, c: 2 }, 1)).toBe(0);
    expect(nextIndex(matches, { r: 0, c: 0 }, -1)).toBe(2);
    expect(nextIndex(matches, { r: 2, c: 0 }, -1)).toBe(1);
    expect(nextIndex([], { r: 0, c: 0 }, 1)).toBe(-1);
  });

  it('cellMatches handles empty input', () => {
    expect(cellMatches(null, '', 'x')).toBe(false);
    expect(cellMatches({ v: 'abc' }, 'abc', '')).toBe(false);
  });
});

describe('replace', () => {
  it('reports no replacements when sheet protection refuses the edit', () => {
    const { wb, id, val } = book({ A1: 'before', A2: 'before' });
    wb.setSheetProtected(id, true);
    const version = wb.version;
    expect(replaceCells(wb, id, findAll(wb, id, 'before'), 'before', 'after')).toBe(0);
    expect(val('A1')).toBe('before');
    expect(val('A2')).toBe('before');
    expect(wb.version).toBe(version);
  });

  it('leaves the cells of a protected range alone and replaces the rest', () => {
    const { wb, id, val } = book({ A1: 'before', A2: 'before' });
    wb.protectRange(id, { r1: 1, c1: 0, r2: 1, c2: 0 });
    expect(replaceCells(wb, id, findAll(wb, id, 'before'), 'before', 'after')).toBe(1);
    expect(val('A1')).toBe('after');
    expect(val('A2')).toBe('before');
  });

  it('counts only changed cells when different text parses to the existing number', () => {
    const { wb, id, val } = book({ A1: '1', A2: 'item1' });
    expect(replaceCells(wb, id, findAll(wb, id, '1'), '1', '01')).toBe(1);
    expect(val('A1')).toBe(1);
    expect(val('A2')).toBe('item01');
    wb.undo();
    expect(val('A2')).toBe('item1');
  });

  it('leaves formulas intact when only their displayed values are searched', () => {
    const { wb, id, val, cell } = book({ A1: '=10+1', A2: '11' });
    const opts = { formulas: false };
    const matches = findAll(wb, id, '1', opts);
    expect(matches).toEqual([{ r: 0, c: 0 }, { r: 1, c: 0 }]);
    expect(replaceCells(wb, id, matches, '1', '9', opts)).toBe(1);
    expect(cell('A1').f).toBe('10+1');
    expect(val('A1')).toBe(11);
    expect(val('A2')).toBe(99);
    wb.undo();
    expect(val('A2')).toBe(11);
    expect(cell('A1').f).toBe('10+1');
    expect(replaceCells(wb, id, [{ r: 0, c: 0 }], '1', '9', { formulas: true })).toBe(1);
    expect(cell('A1').f).toBe('90+9');
  });

  it('replaces within text with the chosen options', () => {
    expect(replaceInText('Rent and rent', 'rent', 'housing')).toBe('housing and housing');
    expect(replaceInText('Rent and rent', 'rent', 'housing', { matchCase: true })).toBe('Rent and housing');
    expect(replaceInText('Rent', 'rent', 'x', { wholeCell: true })).toBe('x');
    expect(replaceInText('Rental', 'rent', 'x', { wholeCell: true })).toBeNull();
    expect(replaceInText('a.b', '.', '-')).toBe('a-b');
    expect(replaceInText('abc', 'z', 'y')).toBeNull();
  });

  it('replaces in cells, keeping types and formats sensible', () => {
    const { wb, id, val, cell } = book(DATA);
    const n = replaceCells(wb, id, findAll(wb, id, 'rent'), 'rent', 'Housing');
    expect(n).toBe(2);
    expect(val('A1')).toBe('Housing');
    expect(val('A2')).toBe('Housingal car');
    // Formula text can be edited too.
    replaceCells(wb, id, [{ r: 1, c: 1 }], 'B1', 'B3');
    expect(cell('B2').f).toBe('B3*2');
    // A number matched through its display becomes the new value with its format kept.
    replaceCells(wb, id, [{ r: 0, c: 3 }], '12%', '25%');
    expect(val('D1')).toBe(0.25);
    expect(cell('D1').s.fmt).toBe('percent');
    // One undo step for the whole batch.
    wb.undo();
    expect(val('D1')).toBe(0.12);
  });

  it('returns 0 when nothing changes', () => {
    const { wb, id } = book(DATA);
    expect(replaceCells(wb, id, [{ r: 0, c: 0 }], 'zzz', 'y')).toBe(0);
    expect(replaceCells(wb, id, [{ r: 9, c: 9 }], 'a', 'b')).toBe(0);
  });
});

describe('regular expression search', () => {
  it('matches and replaces with patterns and capture groups', () => {
    const opts = { regex: true };
    expect(cellMatches({ v: 'Invoice 2024-03' }, 'Invoice 2024-03', String.raw`\d{4}-\d{2}`, opts)).toBe(true);
    expect(cellMatches({ v: 'Invoice' }, 'Invoice', String.raw`\d{4}-\d{2}`, opts)).toBe(false);
    expect(cellMatches({ v: 'abc' }, 'abc', '^A', { regex: true, matchCase: true })).toBe(false);
    expect(cellMatches({ v: 'abc' }, 'abc', '^A', { regex: true })).toBe(true);
    expect(cellMatches({ v: 'abc' }, 'abc', 'b', { regex: true, wholeCell: true })).toBe(false);
    expect(replaceInText('Smith, John', String.raw`(\w+), (\w+)`, '$2 $1', opts)).toBe('John Smith');
    expect(replaceInText('a1 b22 c333', String.raw`\d+`, '#', opts)).toBe('a# b# c#');
    expect(replaceInText('nothing here', String.raw`\d`, '#', opts)).toBeNull();
    // A broken pattern matches nothing instead of throwing.
    expect(compilePattern('(')).toBeNull();
    expect(cellMatches({ v: '(' }, '(', '(', opts)).toBe(false);
  });
});

describe('search within a range', () => {
  it('limits matches to the range when one is given', async () => {
    const { Workbook } = await import('../src/core/workbook.js');
    const { findAll } = await import('../src/core/search.js');
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'apple'); wb.setInput(id, 1, 0, 'apple pie'); wb.setInput(id, 5, 0, 'apple'); wb.setInput(id, 1, 3, 'apple');
    expect(findAll(wb, id, 'apple')).toHaveLength(4);
    expect(findAll(wb, id, 'apple', { range: { r1: 0, c1: 0, r2: 2, c2: 1 } })).toEqual([{ r: 0, c: 0 }, { r: 1, c: 0 }]);
    expect(findAll(wb, id, 'apple', { range: null })).toHaveLength(4);
  });
});
