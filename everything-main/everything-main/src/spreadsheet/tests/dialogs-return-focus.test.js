// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openConditionalFormatting } from '../src/ui/condformat.js';
import { openValidationManager } from '../src/ui/validation.js';
import { openSortDialog } from '../src/ui/sortdialog.js';
import { openDedupeDialog } from '../src/ui/dedupedialog.js';
import { openGoalSeek } from '../src/ui/goalseek.js';
import { openNamesManager } from '../src/ui/names.js';
import { openProtectedRanges } from '../src/ui/protect.js';
import { closeAllModals } from '../src/ui/modal.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); document.body.innerHTML = '<div id="app"></div>'; });
afterEach(() => { closeAllModals(); vi.runAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// Closing these dialogs left focus on the toolbar button that opened them, unlike Format cells.
it.each([
  ['conditional formatting', (ctx) => openConditionalFormatting(ctx)],
  ['data validation', (ctx) => openValidationManager(ctx)],
])('%s hands focus back to the grid when closed', (_name, open) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const focus = vi.fn();
  open({ wb, sheetId: () => id, range: () => ({ r1: 0, c1: 0, r2: 1, c2: 0 }), active: () => ({ r: 0, c: 0 }), grid: { focus, setSelection: vi.fn() } });
  document.querySelector('.modal-root .icon-btn[aria-label="Close"]').click();
  vi.runAllTimers();
  expect(focus).toHaveBeenCalled();
});

// The Data menu hands focus back to its toolbar button, which these dialogs then took as their opener.
it.each([
  ['sort', (ctx) => openSortDialog(ctx, { r1: 0, c1: 0, r2: 1, c2: 0 })],
  ['remove duplicates', (ctx) => openDedupeDialog(ctx, { r1: 0, c1: 0, r2: 1, c2: 0 })],
  ['goal seek', (ctx) => openGoalSeek(ctx)],
  ['named ranges', (ctx) => openNamesManager(ctx)],
  ['protected ranges', (ctx) => openProtectedRanges(ctx)],
])('%s hands focus back to the grid when cancelled with Escape', (_name, open) => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const focus = vi.fn();
  const range = { r1: 0, c1: 0, r2: 1, c2: 0 };
  open({ wb, sheetId: () => id, range: () => range, active: () => ({ r: 0, c: 0 }), run: vi.fn(), grid: { focus, setSelection: vi.fn(), range } });
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  vi.runAllTimers();
  expect(document.querySelector('.modal-root:not(.closing)')).toBeNull();
  expect(focus).toHaveBeenCalled();
});
