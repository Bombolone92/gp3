// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';
import { closeMenu } from '../src/ui/menu.js';

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (q) => ({ matches: !/max-width|pointer/.test(q), addEventListener() {}, removeEventListener() {} })); // a desktop layout, with the menubar
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Element.prototype.setPointerCapture = () => {};
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
  wb.setInput(id, 0, 0, 'top');
  wb.setInput(id, 2, 1, 'b3');
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  vi.runOnlyPendingTimers();
  return { wb, id };
}
const menuItem = (pattern) => [...document.querySelectorAll('.menu .menu-item, .menu [role^="menuitem"], .menu button')].find((b) => pattern.test(b.textContent.trim()));

describe('menu commands', () => {
  it('inserts one row at the active cell when whole columns are selected', () => {
    const { wb, id } = setup();
    const rowsBefore = wb.sheet(id).rows;
    const head = view.el.querySelector('.grid-colhead-clip .hcell[data-c="1"]');
    head.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: 150, clientY: 10 }));
    head.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: 150, clientY: 10 }));
    view.el.querySelector('.ribbon-home button[aria-label="Insert"]').click();
    const above = menuItem(/^Insert Sheet Rows/);
    expect(above).toBeTruthy();
    above.click();
    expect(wb.sheet(id).rows).toBe(rowsBefore + 1);
    expect(wb.getValue(id, 1, 0)).toBe('top'); // one row went in above the active row (row 1), pushing "top" down
  });
});
