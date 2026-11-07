// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { openAiDialog } from '../src/ui/aidialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import * as P from '../src/lib/puter.js';

vi.mock('../src/ui/toast.js', () => ({ toast: vi.fn() }));

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.spyOn(P, 'canAI').mockReturnValue(true);
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeAllModals(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const key = (target, init) => { const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };

// The assistant's box sends on Enter; the formula helper's box took Enter as a new line, which went into the
// request, and asking took tabbing past Close to the button.
it('asks on Enter, as the assistant sends, and starts a new line on Shift+Enter or while composing', async () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  const chat = vi.spyOn(P, 'aiChat').mockResolvedValue('=SUM(A1:A3)');
  for (const mode of ['write', 'ask']) {
    wb.setInput(id, 0, 0, '5');
    const { panel } = openAiDialog({ wb, sheetId: () => id, active: () => ({ r: 1, c: 0 }), range: () => ({ r1: 1, c1: 0, r2: 1, c2: 0 }), grid: { focus() {} } }, { mode });
    const box = panel.querySelector('textarea');
    box.value = 'the total';
    expect(key(box, { shiftKey: true }).defaultPrevented).toBe(false);
    expect(key(box, { isComposing: true }).defaultPrevented).toBe(false);
    expect(chat).not.toHaveBeenCalled();
    expect(key(box).defaultPrevented).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0]).toContain('the total');
    await new Promise((r) => setTimeout(r, 0));
    closeAllModals();
    chat.mockClear();
  }
});
