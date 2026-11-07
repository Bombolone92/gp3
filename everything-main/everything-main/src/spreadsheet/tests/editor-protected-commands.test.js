// @vitest-environment jsdom
import { contentSnapshot } from './helpers/content-snapshot.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';
import * as notifications from '../src/ui/toast.js';

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function setup() {
  const doc = new Doc({ name: 'Budget', path: 'Spreadsheets/Budget.xlsx' });
  const wb = doc.wb;
  const id = wb.activeSheetId;
  for (const [r, a, b] of [[0, 'Name', 'Qty'], [1, 'b', '2'], [2, 'a', '1'], [3, 'c', '3']]) { wb.setInput(id, r, 0, a); wb.setInput(id, r, 1, b); }
  wb.clearHistory();
  wb.setSheetProtected(id, true);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  vi.runOnlyPendingTimers();
  const toast = vi.spyOn(notifications, 'toast');
  return { wb, id, toast, before: JSON.stringify(contentSnapshot(wb)) };
}
const menuItem = (pattern) => [...document.querySelectorAll('.menu [role="menuitem"], .menu button')].find((b) => pattern.test(b.textContent));

describe('commands on a protected sheet', () => {
  it('filter says the sheet is protected and creates no filter', () => {
    const { wb, id, toast, before } = setup();
    view.el.querySelector('.tb-btn[data-cmd="filter"]').click();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/protected/), expect.objectContaining({ icon: 'lock' }));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/Filter added/), expect.anything());
    expect(wb.sheet(id).filter).toBeNull();
    expect(JSON.stringify(contentSnapshot(wb))).toBe(before);
  });

  it('delete rows says the sheet is protected and keeps the selection, since nothing was deleted', async () => {
    const { wb, toast, before } = setup();
    const name = view.el.querySelector('[aria-label="Cell reference"]');
    name.value = 'A2:B3';
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    view.el.querySelector('[data-menu="edit"]').click();
    menuItem(/^Delete$/).click();
    [...document.querySelectorAll('.menu.submenu [role="menuitem"]')].find((b) => /^Rows/.test(b.textContent)).click();
    await vi.advanceTimersByTimeAsync(1);
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/protected/), expect.objectContaining({ icon: 'lock' }));
    expect(view.el.querySelector('.status-left .status-item').textContent).toBe('A2:B3');
    expect(JSON.stringify(contentSnapshot(wb))).toBe(before);
  });

  it('the column filter menu says the sheet is protected instead of opening', async () => {
    const { wb, id, toast } = setup();
    wb.setSheetProtected(id, false);
    wb.setFilterRange(id, { r1: 0, c1: 0, r2: 3, c2: 1 });
    wb.setSheetProtected(id, true);
    const before = JSON.stringify(contentSnapshot(wb));
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    expect(document.querySelector('.menu')).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/protected/), expect.objectContaining({ icon: 'lock' }));
    expect(JSON.stringify(contentSnapshot(wb))).toBe(before);
  });

  it('sort says the sheet is protected instead of reporting a sort', () => {
    const { wb, toast, before } = setup();
    [...view.el.querySelectorAll('.tb-btn')].find(b => b.getAttribute('aria-label') === 'Sort & Filter').click();
    const item = menuItem(/Sort A to Z|Sort sheet A/i);
    expect(item).toBeTruthy();
    item.click();
    expect(toast).toHaveBeenCalledWith(expect.stringMatching(/protected/), expect.objectContaining({ icon: 'lock' }));
    expect(toast).not.toHaveBeenCalledWith(expect.stringMatching(/^Sorted/), expect.anything());
    expect(JSON.stringify(contentSnapshot(wb))).toBe(before);
  });
});
