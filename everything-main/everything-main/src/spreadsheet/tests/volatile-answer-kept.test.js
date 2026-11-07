import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';

// The minute timer asks hasVolatileFormulas() whether the clock has moved on for anything, and the
// answer was worked out afresh every time: on a book of a hundred thousand formulas that walked and
// re-inspected every one of them, blocking the main thread for a fifth of a second a minute, for a
// book where nothing is volatile at all. The answer can only change when the book does.

const A1 = { r1: 0, c1: 0, r2: 0, c2: 0 };

function big(rows = 4000, cols = 10) {
  const cells = {};
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells[`${r},${c}`] = c % 4 === 1 ? { f: `A${r + 1}*${c}` } : { v: r + c };
  }
  return new Workbook({ sheets: [{ name: 'Sheet1', rows: rows + 5, cols: cols + 4, cells }] });
}

describe('whether the book holds a volatile formula', () => {
  it('follows a cell being given one and losing it again, through undo and redo', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=1+1');
    expect(wb.hasVolatileFormulas()).toBe(false);
    wb.setInput(id, 1, 0, '=ROUND(RAND()*10,0)');
    expect(wb.hasVolatileFormulas()).toBe(true);
    wb.setInput(id, 1, 0, '7');
    expect(wb.hasVolatileFormulas()).toBe(false);
    wb.undo();
    expect(wb.hasVolatileFormulas()).toBe(true);
    wb.redo();
    expect(wb.hasVolatileFormulas()).toBe(false);
  });

  it('follows a name, a conditional format and a validation rule being added and taken away', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    expect(wb.hasVolatileFormulas()).toBe(false);
    wb.defineName('Clock', 'NOW()');
    expect(wb.hasVolatileFormulas()).toBe(true);
    wb.deleteName('Clock');
    expect(wb.hasVolatileFormulas()).toBe(false);
    const rule = wb.addRule(id, { range: A1, type: 'formula', value: '=A1<TODAY()', style: { bold: true } });
    expect(wb.hasVolatileFormulas()).toBe(true);
    wb.deleteRule(id, rule);
    expect(wb.hasVolatileFormulas()).toBe(false);
    wb.addValidation(id, { range: A1, type: 'formula', source: '=A1<NOW()' });
    expect(wb.hasVolatileFormulas()).toBe(true);
  });

  it('follows a volatile sheet being added and deleted', () => {
    const wb = new Workbook();
    expect(wb.hasVolatileFormulas()).toBe(false);
    const other = wb.addSheet().id;
    wb.setInput(other, 0, 0, '=TODAY()');
    expect(wb.hasVolatileFormulas()).toBe(true);
    wb.deleteSheet(other);
    expect(wb.hasVolatileFormulas()).toBe(false);
    wb.undo();
    expect(wb.hasVolatileFormulas()).toBe(true);
  });

  it('still recalculates a volatile cell every time the timer fires', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=ROUND(RAND()*1000000,0)');
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
      expect(wb.refreshVolatile()).toBe(true);
      seen.add(wb.getValue(id, 0, 0));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('is not worked out again while the book has not changed', { timeout: 60000 }, () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=1+1');
    let walked = 0;
    const find = wb._findVolatile.bind(wb);
    wb._findVolatile = () => { walked++; return find(); };
    for (let i = 0; i < 50; i++) expect(wb.hasVolatileFormulas()).toBe(false);
    expect(walked).toBe(1);
    wb.setInput(id, 1, 0, '3');
    for (let i = 0; i < 50; i++) expect(wb.hasVolatileFormulas()).toBe(false);
    expect(walked).toBe(2);
  });

  it('costs a large book nothing on the timer ticks after the first', { timeout: 60000 }, () => {
    const wb = big();
    const first = performance.now();
    expect(wb.hasVolatileFormulas()).toBe(false);
    const cost = performance.now() - first;
    const later = performance.now();
    for (let i = 0; i < 60; i++) expect(wb.hasVolatileFormulas()).toBe(false);
    // Sixty ticks — an hour of the timer — together cost a fraction of the one walk they replace.
    expect(performance.now() - later).toBeLessThan(Math.max(cost, 20));
  });
});
