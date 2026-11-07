import { describe, it, expect } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseCellRef } from '../src/core/cell.js';
import { calc } from './helpers/calc.js';

// ISFORMULA and FORMULATEXT over a reference of several cells answer for each cell and spill, as the
// other IS functions do, rather than for the top-left cell alone.

const NA = { error: '#N/A' };
const CELLS = { A1: '=1', A2: 2, A3: '=3', B1: 'x' };

function book(cells = CELLS) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [a1, text] of Object.entries(cells)) {
    const { r, c } = parseCellRef(a1);
    wb.setInput(id, r, c, String(text));
  }
  return { wb, id };
}

function spill(formula, rows = 1, cols = 1, cells = CELLS) {
  const { wb, id } = book(cells);
  wb.setInput(id, 0, 10, `=${formula}`);
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push(wb.getValue(id, r, 10 + c));
  return out;
}

describe('ISFORMULA over a range', () => {
  it('answers per cell and counts formulas with SUMPRODUCT', () => {
    expect(spill('ISFORMULA(A1:A3)', 3)).toEqual([true, false, true]);
    expect(spill('ISFORMULA(A2:A3)', 2)).toEqual([false, true]);
    expect(spill('ISFORMULA(A1:B2)', 2, 2)).toEqual([true, false, false, false]);
    expect(calc('SUMPRODUCT(--ISFORMULA(A1:A3))', CELLS)).toBe(2);
    expect(calc('SUM(IF(ISFORMULA(A1:A3),1,0))', CELLS)).toBe(2);
    // A bounded reference answers for every cell it names, a whole column for the rows in use, as ISBLANK does.
    const tall = spill('ISFORMULA(A1:A1000)', 1000);
    expect(tall.slice(0, 3)).toEqual([true, false, true]);
    expect(tall[999]).toBe(false);
    expect(spill('ISFORMULA(A:A)', 4)).toEqual([true, false, true, null]);
  });

  it('answers a single cell and a value as before', () => {
    expect(calc('ISFORMULA(A1)', CELLS)).toBe(true);
    expect(calc('ISFORMULA(A2)', CELLS)).toBe(false);
    expect(calc('ISFORMULA(C1)', CELLS)).toBe(false);
    expect(calc('ISFORMULA("x")', CELLS)).toBe(false);
    expect(calc('ISFORMULA(1)', CELLS)).toBe(false);
  });

  it('reads the cells of another sheet', () => {
    const { wb, id } = book();
    const data = wb.addSheet('Data').id;
    wb.setInput(data, 0, 0, '=1+1');
    wb.setInput(data, 1, 0, '5');
    wb.setInput(id, 0, 10, '=ISFORMULA(Data!A1:A2)');
    expect([wb.getValue(id, 0, 10), wb.getValue(id, 1, 10)]).toEqual([true, false]);
    wb.setInput(id, 0, 12, '=FORMULATEXT(Data!A1:A2)');
    expect([wb.getValue(id, 0, 12), wb.getValue(id, 1, 12)]).toEqual(['=1+1', NA]);
  });
});

describe('FORMULATEXT over a range', () => {
  it('gives each cell its formula, #N/A where there is none', () => {
    expect(spill('FORMULATEXT(A1:A3)', 3)).toEqual(['=1', NA, '=3']);
    expect(spill('FORMULATEXT(A2:A3)', 2)).toEqual([NA, '=3']);
    expect(spill('FORMULATEXT(A1:B1)', 1, 2)).toEqual(['=1', NA]);
    expect(calc('COUNT(IFERROR(LEN(FORMULATEXT(A1:A3)),""))', CELLS)).toBe(2);
  });

  it('answers a single cell and a value as before', () => {
    expect(calc('FORMULATEXT(A1)', CELLS)).toBe('=1');
    expect(calc('FORMULATEXT(A2)', CELLS)).toEqual(NA);
    expect(calc('FORMULATEXT("x")', CELLS)).toEqual(NA);
  });
});
