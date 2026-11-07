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
  vi.spyOn(P, 'aiChat').mockResolvedValue('=SUM(A1:A9)');
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

// The one refusal this dialog makes itself was silent: nothing was shown and nothing announced, the
// focus simply went back to the box. Pressing Ask twice told a screen-reader user nothing either time.
function open(mode) {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'Item');
  wb.setInput(id, 1, 0, '10');
  const { panel } = openAiDialog({
    wb, sheetId: () => id, active: () => ({ r: 3, c: 0 }),
    range: () => ({ r1: 0, c1: 0, r2: 1, c2: 0 }), grid: { focus() {} },
  }, { mode });
  return { panel, box: panel.querySelector('textarea'), alert: panel.querySelector('[role="alert"]'), submit: () => panel.querySelector('form').requestSubmit() };
}

it.each([
  ['write', 'Type what the formula should calculate'],
  ['ask', 'Type a question about the data'],
])('says what to type when %s is submitted with an empty box', (mode, message) => {
  const { box, alert, submit } = open(mode);
  submit();
  expect(alert.hidden).toBe(false);
  expect(alert.textContent).toBe(message);
  expect(alert.getAttribute('role')).toBe('alert');
  // The message belongs to the box: marked invalid, described by it, and focused.
  expect(box.getAttribute('aria-invalid')).toBe('true');
  expect(box.getAttribute('aria-describedby')).toBe(alert.id);
  expect(document.activeElement).toBe(box);
  expect(P.aiChat).not.toHaveBeenCalled();
});

it('takes the mark and the message off as soon as the box is typed into', () => {
  const { box, alert, submit } = open('write');
  submit();
  box.value = 'total of column A';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  expect(alert.hidden).toBe(true);
  expect(box.hasAttribute('aria-invalid')).toBe(false);
  expect(box.hasAttribute('aria-describedby')).toBe(false);
});

it('asks once the box has a question, and says nothing more about the empty one', async () => {
  const { box, alert, submit } = open('write');
  submit();
  box.value = 'total of column A';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  submit();
  await vi.advanceTimersByTimeAsync(0);
  expect(P.aiChat).toHaveBeenCalledTimes(1);
  expect(alert.hidden).toBe(true);
});
