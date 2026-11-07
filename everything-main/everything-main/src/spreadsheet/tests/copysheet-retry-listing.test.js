// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openCopySheetDialog } from '../src/ui/copysheet.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// A listing that failed for a moment turned "Existing spreadsheet" off for the life of the dialog,
// with no way to look again: the only way back was to close and reopen it.
const panel = () => document.querySelector('.modal-panel');
const existing = () => panel().querySelector('input[type="radio"][value="existing"]');
const reason = () => panel().querySelector('p[role="status"]');
const retry = () => [...panel().querySelectorAll('button')].find((b) => b.textContent === 'Try again');
const fileSel = () => panel().querySelector('[aria-label="Spreadsheet to copy into"]');
const FILE = { name: 'Other.xlsx', path: 'Spreadsheets/Other.xlsx' };

async function open() {
  const wb = new Workbook({ sheets: [{ name: 'Budget' }] });
  openCopySheetDialog({ wb, sheetId: () => wb.activeSheetId, grid: { focus() {} }, run: vi.fn() }, wb.activeSheetId);
  await vi.advanceTimersByTimeAsync(1);
  return wb;
}
const press = async (button) => { button.click(); await vi.advanceTimersByTimeAsync(1); };

it('offers Try again after a failed listing, and takes the choice back on success', async () => {
  const list = vi.spyOn(P, 'listFiles').mockRejectedValue(new Error('offline'));
  await open();
  expect(existing().disabled).toBe(true);
  expect(retry().hidden).toBe(false);
  expect(reason().textContent).toBe('Your spreadsheets could not be listed. Choose Try again to look once more.');
  // The button is a real control of the form: named by its text, and a stop the modal's Tab trap
  // counts, so Tab moves on from it instead of being thrown back to the panel's Close button.
  expect(retry().type).toBe('button');
  expect(retry().tabIndex).toBe(0);
  retry().focus();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  retry().dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);

  list.mockResolvedValue([FILE]);
  await press(retry());
  expect(existing().disabled).toBe(false);
  expect(existing().hasAttribute('aria-describedby')).toBe(false);
  expect(retry().hidden).toBe(true);
  expect(reason().hidden).toBe(false);
  expect(reason().textContent).toBe('Your spreadsheets are listed now.'); // announced, not silent
  expect(fileSel().disabled).toBe(false);
  expect([...fileSel().options].map((o) => o.value)).toEqual([FILE.path]);
  expect(existing().closest('label').classList.contains('is-disabled')).toBe(false);
});

it('announces a second failure instead of repeating the first in silence', async () => {
  vi.spyOn(P, 'listFiles').mockRejectedValue(new Error('offline'));
  await open();
  const first = reason().textContent;
  // The line changes on the way through, so a screen reader hears each attempt.
  retry().click();
  expect(reason().textContent).toBe('Looking for your spreadsheets…');
  expect(retry().getAttribute('aria-busy')).toBe('true');
  expect(retry().disabled).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(reason().textContent).toBe('Still could not list your spreadsheets. Check your connection, then choose Try again.');
  expect(reason().textContent).not.toBe(first);
  expect(existing().disabled).toBe(true);
  expect(retry().hidden).toBe(false);
  expect(retry().disabled).toBe(false);
  expect(retry().hasAttribute('aria-busy')).toBe(false);
});

it('says the folder is empty without offering a retry, since nothing failed', async () => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([]);
  await open();
  expect(existing().disabled).toBe(true);
  expect(retry().hidden).toBe(true);
  expect(reason().textContent).toBe('There is no other spreadsheet in your Spreadsheets folder to copy into.');
});

it('says nothing, and offers no retry, when the first listing simply works', async () => {
  vi.spyOn(P, 'listFiles').mockResolvedValue([FILE]);
  await open();
  expect(existing().disabled).toBe(false);
  expect(reason().hidden).toBe(true);
  expect(retry().hidden).toBe(true);
});

it('reports an empty folder, with no retry, when the listing works on the second try', async () => {
  const list = vi.spyOn(P, 'listFiles').mockRejectedValue(new Error('offline'));
  await open();
  list.mockResolvedValue([]);
  await press(retry());
  expect(existing().disabled).toBe(true);
  expect(retry().hidden).toBe(true);
  expect(reason().textContent).toBe('There is no other spreadsheet in your Spreadsheets folder to copy into.');
});
