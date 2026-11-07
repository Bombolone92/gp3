import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { sheetToCsv } from '../src/core/io.js';
import { findAll } from '../src/core/search.js';

describe('displayed text of formatted spill results', () => {
  it('inherits custom codes across the spill while keeping destination overrides and undo', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const anchor = { r1: 0, r2: 0, c1: 0, c2: 0 };
    wb.setInput(id, 0, 0, '=SEQUENCE(3)');
    wb.applyStyle(id, anchor, { fmt: 'custom', code: '0.00" kg"', bold: true });
    expect([0, 1, 2].map((r) => wb.getDisplay(id, r, 0))).toEqual(['1.00 kg', '2.00 kg', '3.00 kg']);
    expect(wb.spillAt(id, 1, 0).style.bold).toBeUndefined();
    expect(findAll(wb, id, '2.00 kg', { wholeCell: true })).toEqual([{ r: 1, c: 0 }]);
    expect(sheetToCsv(wb, id)).toBe('\ufeff1.00 kg\r\n2.00 kg\r\n3.00 kg\r\n');
    wb.applyStyle(id, { r1: 1, r2: 1, c1: 0, c2: 0 }, { fmt: 'custom', code: '0.0" lb"' });
    expect(wb.getDisplay(id, 1, 0)).toBe('2.0 lb');
    wb.applyStyle(id, anchor, { code: '0.000" kg"' });
    expect(wb.getDisplay(id, 1, 0)).toBe('2.0 lb');
    expect(wb.getDisplay(id, 2, 0)).toBe('3.000 kg');
    wb.undo();
    expect(wb.getDisplay(id, 2, 0)).toBe('3.00 kg');
    wb.undo();
    expect(wb.getDisplay(id, 1, 0)).toBe('2.00 kg');
    expect(wb.getValue(id, 1, 0)).toBe(2);
  });

  it('uses destination formats in displayed text and CSV, and restores them on undo', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=SEQUENCE(3)');
    wb.applyStyle(id, { r1: 0, r2: 0, c1: 0, c2: 0 }, { fmt: 'currency', cur: 'USD', dec: 2 });
    wb.applyStyle(id, { r1: 1, r2: 1, c1: 0, c2: 0 }, { fmt: 'percent', dec: 2 });
    expect(wb.getDisplay(id, 0, 0)).toBe('$1.00');
    expect(wb.getDisplay(id, 1, 0)).toBe('200.00%');
    expect(wb.getDisplay(id, 2, 0)).toBe('$3.00');
    expect(sheetToCsv(wb, id)).toBe('\ufeff$1.00\r\n200.00%\r\n$3.00\r\n');
    wb.undo();
    expect(wb.getDisplay(id, 1, 0)).toBe('$2.00');
    wb.redo();
    expect(wb.getDisplay(id, 1, 0)).toBe('200.00%');
    expect(wb.getValue(id, 1, 0)).toBe(2);
  });
});
