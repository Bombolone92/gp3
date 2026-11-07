// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openPrintDialog } from '../src/ui/printdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { accountStorageKey } from '../src/lib/account-storage.js';
import * as S from '../src/core/selection.js';

vi.mock('../src/ui/print.js', async (original) => ({ ...await original(), printSheet: vi.fn(() => true) }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
let store;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// The roving tabindex was laid over the option groups after the modal had already chosen where to
// start, so every option still had the default tab stop and the dialog opened on the group's first
// button — announced as unchecked while another option was the chosen one — and the Tab trap, seeing
// a focus outside the tab order, threw the first Tab back to the panel's Close button.
function open({ sheets = 1, area = null } = {}) {
  const wb = new Workbook();
  for (let i = 1; i < sheets; i++) wb.addSheet(`Sheet ${i + 1}`);
  wb.setInput(wb.activeSheetId, 0, 0, 'x');
  if (area) store.set(accountStorageKey('spreadsheet:print'), JSON.stringify({ area }));
  const ctx = { wb, sheetId: () => wb.activeSheetId, selection: () => S.single(0, 0), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} }, doc: { name: 'Budget' } };
  return openPrintDialog(ctx).panel;
}
const tab = (node) => { const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }); node.dispatchEvent(e); return e; };

it('starts on the chosen option of the Print group, not on an unchecked one', () => {
  const panel = open({ sheets: 2, area: 'workbook' });
  const focused = document.activeElement;
  expect(focused.textContent).toBe('All sheets (2)');
  // What a screen reader announces on arrival: the group it belongs to, and that it is the choice.
  expect(focused.getAttribute('aria-checked')).toBe('true');
  expect(focused.closest('[role="radiogroup"]').getAttribute('aria-label')).toBe('Print');
  expect(focused.tabIndex).toBe(0);
  expect(panel.querySelector('[aria-label="Print"] [aria-checked="true"]')).toBe(focused);
});

it('lets the first Tab move on, instead of the trap sending it back to Close', () => {
  open({ sheets: 2, area: 'workbook' });
  const event = tab(document.activeElement);
  expect(event.defaultPrevented).toBe(false);
  expect(document.activeElement.getAttribute('aria-label')).not.toBe('Close');
});

it('still starts on "This sheet" when that is the choice', () => {
  open();
  expect(document.activeElement.textContent).toBe('This sheet');
  expect(document.activeElement.getAttribute('aria-checked')).toBe('true');
});
