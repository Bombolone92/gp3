// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openAiDialog } from '../src/ui/aidialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'canAI').mockReturnValue(true);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => {
  closeAllModals();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function open(mode = 'write') {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Hello');
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} },
  }, { mode });
  return { panel, status: panel.querySelector('[role="status"]'), alert: panel.querySelector('[role="alert"]'), button: panel.querySelector('button[type="submit"]') };
}

// The waiting and failure messages went into a plain paragraph, so a screen reader heard nothing
// of them, and a failure stayed under the field after the next, empty, submit.
it('announces the wait and the failure, marks the button busy, and clears a stale failure on the next submit', async () => {
  let fail;
  vi.spyOn(P, 'aiChat').mockReturnValue(new Promise((_, reject) => { fail = reject; }));
  const { panel, status, alert, button } = open();
  expect(status).not.toBeNull();
  panel.querySelector('textarea').value = 'Total of column A';
  panel.querySelector('form').requestSubmit();
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(button.disabled).toBe(true);
  expect(status.textContent).toBe('Asking Puter AI…');
  fail(new Error('boom'));
  await vi.advanceTimersByTimeAsync(0);
  expect(button.hasAttribute('aria-busy')).toBe(false);
  expect(button.disabled).toBe(false);
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toBe('Could not ask the AI: boom');
  expect(status.textContent).toBe('');
  // The stale failure goes; the empty box is refused in its own words rather than in silence.
  panel.querySelector('textarea').value = '';
  panel.querySelector('form').requestSubmit();
  expect(alert.textContent).toBe('Type what the formula should calculate');
  expect(document.activeElement).toBe(panel.querySelector('textarea'));
});

it('announces a reply that held no formula in the status region', async () => {
  vi.spyOn(P, 'aiChat').mockResolvedValue('I am not sure what you mean.');
  const { panel, status, alert } = open();
  panel.querySelector('textarea').value = 'Total of column A';
  panel.querySelector('form').requestSubmit();
  await vi.advanceTimersByTimeAsync(0);
  expect(status.textContent).toBe('The reply held no formula. Try describing it differently.');
  expect(alert.hidden).toBe(true);
});

it('says as an alert that an empty sheet has nothing to ask about', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 0, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), grid: { focus() {} },
  }, { mode: 'ask' });
  panel.querySelector('textarea').value = 'What is here?';
  panel.querySelector('form').requestSubmit();
  const alert = panel.querySelector('[role="alert"]');
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toBe('There is no data on this sheet to ask about.');
});
