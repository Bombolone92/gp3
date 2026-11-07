// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
const flush = () => new Promise((r) => setTimeout(r, 5));
function setup() {
  const wb = new Workbook({ sheets: [{ name: 'One' }, { name: 'Two Data' }], names: [
    { name: 'Rate', ref: '10' }, { name: 'Rate', ref: '20', sheet: 'Two Data' },
    { name: 'OwnerOnly', ref: '30', sheet: 'One' }, { name: 'OwnerWrong', ref: '40', sheet: 'Two Data' },
  ] });
  const id = wb.sheets[0].id, grid = createGrid({ wb, sheetId: id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid };
}
it('completes a name from another sheet and commits the correct value with undo', async () => {
  const { wb, id, grid } = setup();
  try {
    await flush(); grid.beginEdit({ text: "='Two Data'!Ra", mode: 'type' }); await flush();
    expect(grid.el.querySelector('.fx-item .fx-name')?.textContent).toBe('Rate');
    const input = grid.el.querySelector('.grid-editor');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(grid.editState.text).toBe("='Two Data'!Rate");
    grid.commitEdit(); expect(wb.getValue(id, 0, 0)).toBe(20);
    wb.undo(); expect(wb.getValue(id, 0, 0)).toBeNull();
  } finally { grid.destroy(); }
});

