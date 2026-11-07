import { describe, expect, it } from 'vitest';
import { Workbook, cellFromInput, MAX_FORMULA_LENGTH } from '../src/core/workbook.js';
import { parseRange, MAX_TEXT } from '../src/core/cell.js';
import { isError } from '../src/core/formula/functions.js';

const nested = (n) => '('.repeat(n) + '1' + ')'.repeat(n);

/** A file whose first cell holds a formula nested `n` deep, above two plain numbers. */
function loaded(n) {
  const wb = new Workbook({ sheets: [{ name: 'S', cells: { '0,0': { v: null, f: nested(n) }, '1,0': { v: 3 }, '2,0': { v: 1 }, '3,0': { v: null, f: 'HYPERLINK("https://example.com","x")' } } }] });
  return { wb, id: wb.activeSheetId };
}

describe('a formula nested deeper than the parser can follow', () => {
  it.each([1500, 5000, 100000])('at depth %i evaluates to an error and every other reader tolerates it', (n) => {
    const { wb, id } = loaded(n);
    expect(isError(wb.getValue(id, 0, 0))).toBe(true);
    expect(wb.linkAt(id, 0, 0)).toBeNull();
    expect(wb.linkAt(id, 3, 0)?.url).toBe('https://example.com');
    expect(wb.spillRangeAt(id, 0, 0)).toBeNull();
    expect(wb.spillEntries(id)).toEqual([]);
    expect(wb.hasVolatileFormulas()).toBe(false);
    expect(wb.precedents(id, 0, 0)).toEqual([]);
    // Sorting the rows around it still works: the error sinks to the end.
    expect(wb.sortRange(id, parseRange('A1:A3'), 0, true)).toBe(true);
    expect(wb.getValue(id, 0, 0)).toBe(1);
    expect(wb.getValue(id, 1, 0)).toBe(3);
    expect(wb.getCell(id, 2, 0).f).toBe(nested(n));
    expect(() => wb.toJSON()).not.toThrow();
  });

  it('is unreadable to rules and names without throwing', () => {
    const { wb, id } = loaded(5000);
    wb.addRule(id, { type: 'formula', range: parseRange('B1:B3'), value: nested(5000) + '>0', style: { bold: true } });
    expect(wb.conditionalStyle(id, 0, 1, 5)).toBeNull();
    expect(wb.evalRuleFormula(id, nested(5000), parseRange('B1:B3'), 0, 1)).toBeNull();
    expect(typeof wb.defineName('Deep', nested(5000))).toBe('string');
    wb.addValidation(id, { type: 'formula', range: parseRange('C1:C1'), source: nested(5000) + '>0', strict: true });
    expect(() => wb.validateInput(id, 0, 2, '5')).not.toThrow();
  });
});

describe('typing a formula that is too long or too deeply nested', () => {
  it('keeps the entry as text instead of a formula nothing can read', () => {
    expect(cellFromInput('=' + nested(300), null)).toEqual({ v: '=' + nested(300), f: null, s: undefined });
    const long = '=' + 'A1+'.repeat(MAX_FORMULA_LENGTH / 3 + 1) + '1';
    expect(long.length).toBeGreaterThan(MAX_FORMULA_LENGTH);
    expect(cellFromInput(long, { bold: true })).toEqual({ v: long, f: null, s: { bold: true } });
    expect(cellFromInput('=' + nested(60) + '+"(((("', null).f).toBe(nested(60) + '+"(((("');
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=' + nested(100000));
    expect(wb.getCell(id, 0, 0).f).toBeNull();
    expect(wb.getValue(id, 0, 0)).toBe(('=' + nested(100000)).slice(0, MAX_TEXT)); // text keeps what a file can hold
    expect(wb.linkAt(id, 0, 0)).toBeNull();
  });
});
