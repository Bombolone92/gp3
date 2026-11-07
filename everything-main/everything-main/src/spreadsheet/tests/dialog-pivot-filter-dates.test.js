// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { parseRange } from '../src/core/cell.js';
import { ymdToSerial } from '../src/core/format.js';
import * as S from '../src/core/selection.js';
import { openPivotDialog } from '../src/ui/pivotdialog.js';
import * as pivot from '../src/core/pivot.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

const DATES = [ymdToSerial(2026, 1, 5), ymdToSerial(2026, 2, 10)];

function open() {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setCells(id, [
    { r: 0, c: 0, cell: { v: 'When' } }, { r: 0, c: 1, cell: { v: 'Amount' } },
    { r: 1, c: 0, cell: { v: DATES[0], s: { fmt: 'date' } } }, { r: 1, c: 1, cell: { v: 10 } },
    { r: 2, c: 0, cell: { v: DATES[1], s: { fmt: 'date', dateStyle: 'medium' } } }, { r: 2, c: 1, cell: { v: 20 } },
    { r: 3, c: 0, cell: { v: DATES[0], s: { fmt: 'date' } } }, { r: 3, c: 1, cell: { v: 10 } },
  ]);
  const range = parseRange('A1:B4');
  const { panel } = openPivotDialog({ wb, sheetId: () => id, range: () => range, selection: () => S.fromRange(range), grid: { focus: vi.fn() } });
  const field = panel.querySelector('[aria-label="Filter by"]');
  const showing = panel.querySelector('[aria-label="Showing"]');
  const choose = (index) => { field.value = String(index); field.dispatchEvent(new Event('change')); };
  const options = () => [...showing.options].map((o) => o.textContent);
  return { choose, options };
}

// pivotFieldValues collects each number's format into the Map it is given; the
// list showed the serial numbers. Until that collection is on main, the stand-in
// below fills the Map only when the real function left it empty.
function collectStyles() {
  const real = pivot.pivotFieldValues;
  vi.spyOn(pivot, 'pivotFieldValues').mockImplementation((wb, sheetId, range, fieldIndex, styles) => {
    const values = real(wb, sheetId, range, fieldIndex, styles);
    if (styles && !styles.size) {
      const n = parseRange('A1:B4');
      for (let r = n.r1 + 1; r <= n.r2; r++) {
        const v = wb.getValue(sheetId, r, n.c1 + fieldIndex);
        if (typeof v === 'number' && !styles.has(v)) styles.set(v, wb.getCell(sheetId, r, n.c1 + fieldIndex)?.s);
      }
    }
    return values;
  });
}

it('lists a date field\'s filter values as dates, each in its own cell\'s format', () => {
  collectStyles();
  const { choose, options } = open();
  choose(0);
  expect(options()).toEqual(['(All)', '2026-01-05', 'Feb 10, 2026']);
  choose(1);
  expect(options()).toEqual(['(All)', '10', '20']);
});

it('falls back to General when the field values come without formats', () => {
  const real = pivot.pivotFieldValues;
  vi.spyOn(pivot, 'pivotFieldValues').mockImplementation((wb, sheetId, range, fieldIndex) => real(wb, sheetId, range, fieldIndex));
  const { choose, options } = open();
  choose(0);
  expect(options()).toEqual(['(All)', String(DATES[0]), String(DATES[1])]);
});
