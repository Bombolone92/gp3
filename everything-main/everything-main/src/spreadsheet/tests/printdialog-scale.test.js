// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openPrintDialog } from '../src/ui/printdialog.js';
import { printSheet } from '../src/ui/print.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as S from '../src/core/selection.js';

vi.mock('../src/ui/print.js', async (original) => ({ ...await original(), printSheet: vi.fn(() => true) }));
vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const data = new Map();
  vi.stubGlobal('localStorage', { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) });
  document.body.innerHTML = '<div id="app"></div>';
  printSheet.mockClear();
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function open() {
  const wb = new Workbook();
  const ctx = { wb, sheetId: () => wb.activeSheetId, selection: () => S.single(0, 0), range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} } };
  const modal = openPrintDialog(ctx);
  modal.panel.querySelector('[aria-label="Scale"] [data-key="scale"]').click();
  const scale = modal.panel.querySelector('[aria-label="Scale percent"]');
  const error = modal.panel.querySelector(`#${scale.getAttribute('aria-describedby')}`);
  const type = async (text) => { scale.value = text; scale.dispatchEvent(new Event('input')); };
  const submit = () => modal.panel.querySelector('form').requestSubmit();
  return { modal, scale, error, type, submit, isOpen: () => !modal.panel.closest('.modal-root').classList.contains('closing') };
}

// A custom scale outside 10 to 400 was clamped without a word and the sheet printed at the clamped
// size while the field still showed the typed number.
it.each(['5', '500', '', 'abc'])('refuses the custom scale %j with a message beside the field and does not print', async (text) => {
  const { scale, error, type, submit, isOpen } = open();
  type(text);
  await submit();
  expect(printSheet).not.toHaveBeenCalled();
  expect(isOpen()).toBe(true);
  expect(error.hidden).toBe(false);
  expect(error.textContent).toBe('Scale is 10 to 400 percent');
  expect(scale.getAttribute('aria-invalid')).toBe('true');
  expect(document.activeElement).toBe(scale);
  // A changed value is no longer the one refused; an allowed one prints at that scale.
  type('80');
  expect(error.hidden).toBe(true);
  expect(scale.hasAttribute('aria-invalid')).toBe(false);
  await submit();
  expect(printSheet).toHaveBeenCalledTimes(1);
  expect(printSheet.mock.calls[0][3]).toMatchObject({ fit: 'scale', scale: 80 });
  expect(isOpen()).toBe(false);
});

it('prints at the boundary scales 10 and 400', async () => {
  for (const text of ['10', '400']) {
    const { type, submit, isOpen } = open();
    type(text);
    await submit();
    expect(isOpen()).toBe(false);
    expect(printSheet).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), undefined, expect.objectContaining({ fit: 'scale', scale: Number(text) }));
    closeAllModals();
    vi.runOnlyPendingTimers();
  }
});


it('keeps preparation cancellable and prevents duplicate submissions', async () => {
  let finish;
  printSheet.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const { modal, type, submit, isOpen } = open();
  type('100'); submit(); submit();
  expect(printSheet).toHaveBeenCalledOnce();
  const button = modal.panel.querySelector('[type="submit"]');
  expect(button.disabled).toBe(true);
  expect(button.textContent).toBe('Preparing…');
  expect(isOpen()).toBe(true);
  const signal = printSheet.mock.calls[0][3].signal;
  modal.close();
  expect(signal.aborted).toBe(true);
  finish(false); await Promise.resolve();
  expect(isOpen()).toBe(false);
});
