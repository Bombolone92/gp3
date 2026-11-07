// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openPrintDialog } from '../src/ui/printdialog.js';
import { printSheet } from '../src/ui/print.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';

vi.mock('../src/ui/print.js', async (original) => ({ ...await original(), printSheet: vi.fn(() => true) }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const data = new Map();
  vi.stubGlobal('localStorage', { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const press = (target, key, init = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

it('labels each print option group, gives it one tab stop, and moves the choice with the arrow keys', () => {
  const wb = new Workbook();
  wb.setInput(wb.activeSheetId, 0, 0, 'x');
  const ctx = { wb, sheetId: () => wb.activeSheetId, selection: () => S.single(0, 0), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} }, doc: { name: 'Budget' } };
  openPrintDialog(ctx);
  const groups = [...document.querySelectorAll('[role="radiogroup"]')];
  expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Print', 'Orientation', 'Scale', 'Margins']);
  for (const group of groups) {
    const stops = [...group.querySelectorAll('[role="radio"]')].filter((r) => r.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute('aria-checked')).toBe('true');
  }

  const [portrait, landscape] = groups[1].querySelectorAll('[role="radio"]');
  portrait.focus();
  expect(press(portrait, 'ArrowRight').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(landscape);
  expect(landscape.getAttribute('aria-checked')).toBe('true');
  expect([landscape.tabIndex, portrait.tabIndex]).toEqual([0, -1]);
  expect(press(landscape, 'ArrowDown').defaultPrevented).toBe(true); // wraps round
  expect(document.activeElement).toBe(portrait);
  expect(press(portrait, 'ArrowUp').defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(landscape);
  // Composing input and other keys are left alone.
  expect(press(landscape, 'ArrowRight', { isComposing: true }).defaultPrevented).toBe(false);
  expect(press(landscape, 'Tab').defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(landscape);

  // Options that cannot apply (no selection, one sheet) are skipped over.
  const [sheet, selection, all] = groups[0].querySelectorAll('[role="radio"]');
  expect([selection.disabled, all.disabled]).toEqual([true, true]);
  sheet.focus();
  press(sheet, 'ArrowRight');
  expect(document.activeElement).toBe(sheet);
  expect(sheet.getAttribute('aria-checked')).toBe('true');

  // The choice made by keyboard is what prints.
  document.querySelector('.modal-panel form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  expect(printSheet).toHaveBeenCalledWith(wb, wb.activeSheetId, 'Budget', expect.objectContaining({ orientation: 'landscape', area: 'sheet' }));
});

it('keeps a group reachable when the remembered choice is no longer offered', () => {
  localStorage.setItem('spreadsheet:print', JSON.stringify({ fit: 'nonsense' }));
  const wb = new Workbook();
  const ctx = { wb, sheetId: () => wb.activeSheetId, selection: () => S.single(0, 0), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} } };
  openPrintDialog(ctx);
  const scale = document.querySelector('[role="radiogroup"][aria-label="Scale"]');
  const stops = [...scale.querySelectorAll('[role="radio"]')].filter((r) => r.tabIndex === 0 && !r.disabled);
  expect(stops).toHaveLength(1);
});
