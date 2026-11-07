import { describe, it, expect } from 'vitest';
import { TEMPLATES, templateById } from '../src/core/templates.js';

describe('templates', () => {
  it('build clean workbooks: no formula errors, nothing to undo, not dirty', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(10);
    for (const t of TEMPLATES) {
      const wb = t.build();
      expect(wb.sheets.length).toBeGreaterThan(0);
      expect(wb.dirty).toBe(false);
      expect(wb.canUndo()).toBe(false);
      for (const sh of wb.sheets) {
        const used = wb.usedRange(sh.id);
        if (!used) continue;
        for (let r = used.r1; r <= used.r2; r++) {
          for (let c = used.c1; c <= used.c2; c++) {
            const v = wb.getValue(sh.id, r, c);
            expect(v && typeof v === 'object' && v.error ? `${t.id} ${sh.name} r${r + 1}c${c + 1} ${v.error}` : null).toBeNull();
          }
        }
      }
    }
  });

  it('have working formulas, validation, rules, and charts', () => {
    const invoice = templateById('invoice').build();
    const inv = invoice.sheets[0].id;
    expect(invoice.getValue(inv, 11, 3)).toBe(12 * 95);
    expect(invoice.getDisplay(inv, 22, 3)).toBe('$5,146.20');
    expect(invoice.tablesOn(inv)[0]).toMatchObject({ name: 'Items', calc: { 3: 'IF(OR([@Qty]="",[@[Unit price]]=""),"",[@Qty]*[@[Unit price]])' } });
    expect(invoice.getCell(inv, 18, 3).f).toBe(invoice.tablesOn(inv)[0].calc[3]); // every line has the formula
    // A new line typed under the table joins it and gets the Amount formula.
    invoice.setInput(inv, 19, 0, 'Support');
    expect(invoice.tablesOn(inv)[0].range.r2).toBe(19);
    expect(invoice.getCell(inv, 19, 3).f).toBe(invoice.tablesOn(inv)[0].calc[3]);

    const todo = templateById('todo').build();
    const t = todo.sheets[0].id;
    expect(todo.validationAt(t, 1, 0)?.type).toBe('checkbox');
    expect(todo.validationAt(t, 1, 3)?.type).toBe('list');
    expect(todo.getValue(t, 2, 7)).toBe(1); // one task done
    expect(todo.sheet(t).rules.length).toBeGreaterThanOrEqual(3);

    const expenses = templateById('expenses').build();
    const summary = expenses.sheets[1];
    expect(summary.charts).toHaveLength(1);
    expect(expenses.getValue(summary.id, 1, 1)).toBe(1500);
    expect(expenses.tableByName('Expenses')?.table.range).toEqual({ r1: 0, c1: 0, r2: 13, c2: 3 });
    expect(templateById('todo').build().tableByName('Tasks')).toBeTruthy();

    const cal = templateById('calendar').build();
    const cs = cal.sheets[0].id;
    // The first week starts on a Monday and the 1st appears exactly once among the day cells.
    let ones = 0;
    for (let r = 4; r <= 15; r += 2) for (let c = 0; c < 7; c++) { const v = cal.getValue(cs, r, c); if (typeof v === 'number' && cal.getDisplay(cs, r, c) === '1') ones++; }
    expect(ones).toBe(1);
    expect(cal.getDisplay(cs, 0, 0)).toMatch(/\d{4}$/);

    const hab = templateById('habits').build();
    const hs = hab.sheets[0].id;
    expect(hab.validationAt(hs, 3, 1)?.type).toBe('checkbox');
    expect(hab.getDisplay(hs, 2, 1)).toBe('1'); // day numbers across the top
    expect(typeof hab.getValue(hs, 3, 32)).toBe('number'); // done count
    const logId = expenses.sheets[0].id;
    expect(expenses.listOptionsFor(logId, expenses.validationAt(logId, 1, 1))).toContain('Food');

    const loan = templateById('loan').build();
    expect(loan.getDisplay(loan.sheets[0].id, 3, 4)).toBe('$1,580.17');

    const grades = templateById('gradebook').build();
    expect(grades.getValue(grades.sheets[0].id, 2, 6)).toBe('B');

    // A term shorter than the 60 scheduled rows ends at $0.00, not at -$0.00 from floating-point dust.
    loan.setInput(loan.sheets[0].id, 5, 1, '2');
    expect(loan.getDisplay(loan.sheets[0].id, 4, 4)).toBe('24');
    expect(loan.getDisplay(loan.sheets[0].id, 33, 5)).toBe('$0.00');
    expect(loan.getDisplay(loan.sheets[0].id, 34, 5)).toBe('');

    const timeline = templateById('timeline').build();
    const tl = timeline.sheets[0].id;
    expect(timeline.getValue(tl, 3, 4)).toBe(3);
    expect(timeline.sheet(tl).frozenCols).toBe(5);
    expect(templateById('nope')).toBeNull();
  });
});
