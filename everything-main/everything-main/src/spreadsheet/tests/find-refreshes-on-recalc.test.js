// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFindBar } from '../src/ui/findbar.js';
import { Workbook } from '../src/core/workbook.js';

// The find panel caches its match list against the workbook's version. Recalculate all formulas (F9), a
// change of regional format and an answer arriving for an AI formula change what the cells show without
// changing a cell, so the version stays put and the list went on describing the values from before. The
// engine announces those with a 'recalc' notice; the panel collects its matches again when one arrives.
let bar;
beforeEach(() => vi.useFakeTimers());
afterEach(() => { bar?.destroy(); bar = null; vi.clearAllTimers(); vi.useRealTimers(); document.body.replaceChildren(); });

function setup() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'target');
  wb.setInput(id, 1, 0, '=A1');
  const grid = {
    active: { r: 0, c: 0 }, range: { r1: 0, c1: 0, r2: 0, c2: 0 },
    setHighlights: vi.fn(), setSelection: vi.fn((s) => { grid.active = s.active; }), focus: vi.fn(),
  };
  bar = createFindBar({ wb, grid, sheetId: () => id, activeCell: () => null, announce: vi.fn(), subscribe: () => vi.fn() });
  document.body.append(bar.el);
  bar.open();
  const query = bar.el.querySelector('[aria-label="Find"]');
  query.value = 'target';
  query.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(150);
  return { wb, id, grid };
}

const count = () => bar.el.querySelector('.find-count').textContent;

it('collects its matches again when the engine says it recalculated', () => {
  const { wb, id } = setup();
  expect(count()).toBe('1 of 2'); // A1 itself and the formula that shows its text
  // A recalculation changes what the cells show without bumping the workbook's version.
  const version = wb.version;
  wb.sheet(id).cells.get('0,0').v = 'other';
  wb.recalculate();
  expect(wb.version).toBe(version);
  expect(count()).toBe('No matches');
});

it('leaves the list alone while the panel is closed', () => {
  const { wb, id } = setup();
  bar.close();
  wb.sheet(id).cells.get('0,0').v = 'other';
  expect(() => wb.recalculate()).not.toThrow();
});
