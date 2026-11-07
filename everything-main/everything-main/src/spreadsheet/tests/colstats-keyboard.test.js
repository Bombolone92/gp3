// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openColumnStats } from '../src/ui/colstats.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  document.body.innerHTML = '<div id="app"><button>Open stats</button></div>';
  document.querySelector('button').focus();
});

afterEach(() => {
  closeAllModals();
  vi.runAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it('keeps column navigation focused, including when the current direction reaches an edge', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '10');
  wb.setInput(id, 0, 1, '20');
  wb.setInput(id, 0, 2, '30');
  const modal = openColumnStats({ wb, sheetId: () => id }, 0);
  const button = (label) => modal.panel.querySelector(`[aria-label="${label} column"]`);
  button('Next').focus();
  button('Next').click();
  expect(modal.panel.querySelector('.colstats-title').textContent).toBe('Column B');
  expect(document.activeElement).toBe(button('Next'));
  button('Next').click();
  expect(modal.panel.querySelector('.colstats-title').textContent).toBe('Column C');
  expect(button('Next').disabled).toBe(true);
  expect(document.activeElement).toBe(button('Previous'));
  button('Previous').click();
  expect(document.activeElement).toBe(button('Previous'));
  button('Previous').click();
  expect(modal.panel.querySelector('.colstats-title').textContent).toBe('Column A');
  expect(button('Previous').disabled).toBe(true);
  expect(document.activeElement).toBe(button('Next'));
  modal.close();
  expect(document.activeElement).toBe(document.querySelector('#app button'));
});
