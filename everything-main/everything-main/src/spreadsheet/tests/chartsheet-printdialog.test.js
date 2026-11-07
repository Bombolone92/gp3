// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openPrintDialog } from '../src/ui/printdialog.js';
import { sheetPrintPrefs, printSheet } from '../src/ui/print.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';

vi.mock('../src/ui/print.js', async original => ({ ...await original(), printSheet: vi.fn(() => true) }));
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true }));
  localStorage.clear(); printSheet.mockClear(); document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it.each([false, true])('offers page setup without cell options on a chart sheet, native settings=%s', native => {
  const wb = new Workbook({ sheets: [{ name: 'Overview', kind: 'chart', ...(native ? { printSettings: {
    orientation: 'portrait', scale: 70, gridlines: true, headings: true, fitWidth: 4, fitHeight: 2,
  } } : {}) }, { name: 'Data' }] });
  const sheet = wb.sheets[0], id = sheet.id;
  expect(sheetPrintPrefs(sheet)).toMatchObject({ fit: 'pages', fitWidth: 1, fitHeight: 1, title: false, gridlines: false, headers: false,
    orientation: native ? 'portrait' : 'landscape' });
  const modal = openPrintDialog({ wb, sheetId: () => id, selection: () => S.single(0, 0), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} } });
  expect(modal.panel.querySelector('[data-key="selection"]')).toBeNull();
  expect(modal.panel.querySelector('[aria-label="Scale"]')).toBeNull();
  expect(modal.panel.querySelector('.print-checks')).toBeNull();
  expect(modal.panel.querySelector('[aria-label="Pages wide"]').closest('div.field').hidden).toBe(true);
  modal.panel.querySelector('form').requestSubmit();
  expect(printSheet).toHaveBeenLastCalledWith(wb, id, undefined, expect.objectContaining({ fitWidth: 1, fitHeight: 1, gridlines: false }));
});
