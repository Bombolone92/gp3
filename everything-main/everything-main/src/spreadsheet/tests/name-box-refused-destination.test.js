// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { createFormulaBar } from '../src/ui/formulabar.js';
import { Workbook } from '../src/core/workbook.js';
import * as notifications from '../src/ui/toast.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

function setup(goToName) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  const listeners = new Set();
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {}, onSelection: () => { for (const fn of listeners) fn(); }, onEdit: () => { for (const fn of listeners) fn(); } });
  const bar = createFormulaBar({
    wb, grid, run() {}, announce() {}, goToName,
    sheetId: () => grid.sheetId, activeCell: () => wb.getCell(grid.sheetId, grid.active.r, grid.active.c),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  });
  document.body.replaceChildren(grid.el, bar.el);
  return { wb, grid, bar, nameBox: bar.el.querySelector('.name-box') };
}

// A destination the go-to refused with a toast of its own (a table column that does not exist, a
// sheet that is not there) fell through to naming the selection, whose rules then complained about
// the spelling in a second toast.
it('leaves a destination the go-to refused in the name box without also refusing it as a new name', async () => {
  const goToName = vi.fn(() => null);
  const { wb, grid, nameBox } = setup(goToName);
  await flush();
  const toast = vi.spyOn(notifications, 'toast').mockImplementation(() => {});
  try {
    nameBox.value = 'Tbl[Nope]';
    nameBox.focus();
    key(nameBox, 'Enter');
    expect(goToName).toHaveBeenCalledWith('Tbl[Nope]');
    expect(toast).not.toHaveBeenCalled();
    expect(wb.names).toHaveLength(0);
    expect(nameBox.value).toBe('Tbl[Nope]');
    expect([nameBox.selectionStart, nameBox.selectionEnd]).toEqual([0, 'Tbl[Nope]'.length]);
    // Text that is not a location at all still gets the naming rules' answer.
    goToName.mockReturnValue(false);
    nameBox.value = '1st';
    key(nameBox, 'Enter');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(wb.validateName('1st'), expect.objectContaining({ icon: 'alert' }));
  } finally { grid.destroy(); }
});
