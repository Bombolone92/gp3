import { describe, expect, it } from 'vitest';
import { parseInput, editText, formatValue, TYPED_ERRORS } from '../src/core/format.js';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

const ERRORS = ['#N/A', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#NULL!'];

// A typed #N/A was text that looked exactly like the error: ISNA, ISERROR and IFERROR did not see it, SUM
// skipped it, and ISTEXT said TRUE. The seven error spellings now become error values.
describe('an error spelling typed into a cell', () => {
  it.each(ERRORS)('reads %s as the error value, whatever its case or spacing', (code) => {
    expect(parseInput(code)).toEqual({ v: { error: code }, f: null, fmt: null });
    expect(parseInput(` ${code.toLowerCase()} `)).toEqual({ v: { error: code }, f: null, fmt: null });
    expect(TYPED_ERRORS.has(code)).toBe(true);
  });

  it.each(["'#N/A", '#SPILL!', '#CALC!', '#CYCLE!', '#N/A!', '#REF', 'N/A', '#DIV/0'])('keeps %s as text', (text) => {
    const { v } = parseInput(text);
    expect(v).toBe(text.replace(/^'/, ''));
  });

  it('is an error to the formulas that ask, and stops a SUM as an error cell does', () => {
    expect(calc('ISNA(A1)', { A1: '#N/A' })).toBe(true);
    expect(calc('ISERROR(A1)', { A1: '#DIV/0!' })).toBe(true);
    expect(calc('ISTEXT(A1)', { A1: '#N/A' })).toBe(false);
    expect(calc('IFERROR(A1,"caught")', { A1: '#N/A' })).toBe('caught');
    expect(calc('ERROR.TYPE(A1)', { A1: '#VALUE!' })).toBe(3);
    expect(calc('SUM(A1:A2)', { A1: '#N/A', A2: '5' })).toEqual({ error: '#N/A' });
    expect(calc('SUM(A1:A2)', { A1: "'#N/A", A2: '5' })).toBe(5);
  });

  it('is stored, shown and edited as the error, and stays text in a Plain text cell or behind an apostrophe', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '#n/a');
    expect(wb.getCell(id, 0, 0)).toEqual({ v: { error: '#N/A' }, f: null });
    expect(wb.getDisplay(id, 0, 0)).toBe('#N/A');
    // Opening the cell shows the code, and Enter keeps the error value, not a formula.
    expect(editText(wb.getCell(id, 0, 0))).toBe('#N/A');
    wb.setInput(id, 0, 0, editText(wb.getCell(id, 0, 0)));
    expect(wb.getCell(id, 0, 0)).toEqual({ v: { error: '#N/A' }, f: null });
    wb.setInput(id, 1, 0, "'#N/A");
    expect(wb.getCell(id, 1, 0).v).toBe('#N/A');
    expect(editText(wb.getCell(id, 1, 0))).toBe("'#N/A"); // text that would read as an error keeps its apostrophe
    wb.applyStyle(id, parseRange('A3'), { fmt: 'text' });
    wb.setInput(id, 2, 0, '#N/A');
    expect(wb.getCell(id, 2, 0).v).toBe('#N/A');
    // A formula literal still works, and an error the typed form cannot spell still edits as one.
    wb.setInput(id, 3, 0, '=#N/A');
    expect(wb.getValue(id, 3, 0)).toEqual({ error: '#N/A' });
    expect(editText({ v: { error: '#SPILL!' }, f: null })).toBe('=#SPILL!');
    expect(formatValue({ error: '#N/A' }, {})).toBe('#N/A');
  });

  it('is read the same way by Convert to numbers and by Split text to columns', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'#DIV/0!");
    wb.transformText(id, parseRange('A1'), 'number');
    expect(wb.getCell(id, 0, 0).v).toEqual({ error: '#DIV/0!' });
    wb.setInput(id, 1, 0, "'#N/A,5");
    wb.splitTextToColumns(id, parseRange('A2'), ',');
    expect(wb.getCell(id, 1, 0).v).toEqual({ error: '#N/A' });
    expect(wb.getCell(id, 1, 1).v).toBe(5);
  });
});
