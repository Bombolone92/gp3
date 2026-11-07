import { afterEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import * as format from '../src/core/format.js';

afterEach(() => vi.restoreAllMocks());

describe('fill series precision', () => {
  it.each([
    ['linear', 1e-12, 1e-12, [1e-12, 2e-12, 3e-12]],
    ['linear', -1e-12, -1e-12, [-1e-12, -2e-12, -3e-12]],
    ['growth', 1e-12, 0.5, [1e-12, 5e-13, 2.5e-13]],
    ['linear', Number.MIN_VALUE, Number.MIN_VALUE, [Number.MIN_VALUE, 1e-323, 1.5e-323]],
    ['linear', 0.1, 0.1, [0.1, 0.2, 0.3]],
    ['linear', 123456789012345, 1, [123456789012345, 123456789012346, 123456789012347]],
  ])('preserves a %s series starting at %s with step %s', (type, start, step, expected) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, String(start));
    wb.clearHistory();
    expect(wb.fillSeries(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { type, step })).toBe(2);
    expect(expected.map((_, r) => wb.getValue(id, r, 0))).toEqual(expected);
    expect(wb.undoLabels()).toHaveLength(1);
    wb.undo();
    expect(wb.getValue(id, 0, 0)).toBe(start);
    expect(wb.getValue(id, 1, 0)).toBeNull();
    wb.redo();
    expect(expected.map((_, r) => wb.getValue(id, r, 0))).toEqual(expected);
  });
});

describe('growth fill series', () => {
  it('retains large finite numbers and stops before overflowing into invalid cell values', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1e307');
    wb.setInput(id, 2, 0, 'keep');
    wb.clearHistory();
    expect(wb.fillSeries(id, { r1: 0, c1: 0, r2: 3, c2: 0 }, { type: 'growth', step: 10 })).toBe(1);
    expect(wb.getValue(id, 1, 0)).toBe(1e308);
    expect(wb.getValue(id, 2, 0)).toBe('keep');
    const restored = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(restored.getValue(id, 1, 0)).toBe(1e308);
    wb.undo();
    expect(wb.getValue(id, 1, 0)).toBeNull();
    expect(wb.getValue(id, 2, 0)).toBe('keep');
  });

  it.each([
    [-2, 2, -16, [-2, -4, -8, -16]],
    [-16, 0.5, -2, [-16, -8, -4, -2]],
    [2, 2, 16, [2, 4, 8, 16]],
    [16, 0.5, 2, [16, 8, 4, 2]],
  ])('fills from %s with multiplier %s through stop %s', (first, step, stop, values) => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, String(first));
    wb.clearHistory();
    expect(wb.fillSeries(id, { r1: 0, c1: 0, r2: 5, c2: 0 }, { type: 'growth', step, stop })).toBe(3);
    expect(values.map((_, r) => wb.getValue(id, r, 0))).toEqual(values);
    expect(wb.getValue(id, 4, 0)).toBeNull();
    wb.undo();
    expect(wb.getValue(id, 1, 0)).toBeNull();
    wb.redo();
    expect(wb.getValue(id, 3, 0)).toBe(stop);
  });
});

function setup(day = 28) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const start = format.ymdToSerial(2026, 8, day) + 0.5;
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: start, s: { fmt: 'datetime' } } }]);
  wb.clearHistory();
  return { wb, id, start };
}

describe('weekday fill series', () => {
  it('does not walk every intervening day for a large step', () => {
    const { wb, id, start } = setup(); // Friday
    const original = format.serialToYMD;
    let reads = 0;
    vi.spyOn(format, 'serialToYMD').mockImplementation((serial) => {
      if (++reads > 100) throw new Error('Walked intervening calendar days');
      return original(serial);
    });
    expect(wb.fillSeries(id, { r1: 0, c1: 0, r2: 2, c2: 0 }, { type: 'date', unit: 'weekday', step: 1000000 })).toBe(2);
    expect(wb.getValue(id, 1, 0)).toBe(start + 1400000);
    expect(wb.getValue(id, 2, 0)).toBe(start + 2800000);
    expect(wb.getCell(id, 1, 0).s.fmt).toBe('datetime');
    wb.undo();
    expect(wb.getValue(id, 1, 0)).toBeNull();
    expect(wb.getValue(id, 0, 0)).toBe(start);
  });

  it('matches day-by-day counting for both directions, weekends, and rounded steps', () => {
    for (let day = 24; day <= 30; day++) {
      for (const step of [-11, -5, -2.5, -1, 0, 0.5, 1, 5, 11]) {
        const { wb, id, start } = setup(day);
        let expected = start;
        wb.fillSeries(id, { r1: 0, c1: 0, r2: 3, c2: 0 }, { type: 'date', unit: 'weekday', step });
        for (let r = 1; r <= 3; r++) {
          let remaining = Math.abs(Math.round(step));
          while (remaining) {
            expected += step < 0 ? -1 : 1;
            const weekday = format.serialToYMD(expected).weekday;
            if (weekday !== 0 && weekday !== 6) remaining--;
          }
          expect(wb.getValue(id, r, 0)).toBe(expected);
        }
      }
    }
  });
});
