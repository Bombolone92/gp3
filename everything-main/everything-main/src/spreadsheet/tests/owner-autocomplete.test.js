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
it('uses the formula owner’s scope while another sheet is displayed for picking', async () => {
  const { wb, id, grid } = setup();
  try {
    await flush(); grid.beginEdit({ text: '=SUM(', mode: 'type' });
    grid.setSheet(wb.sheets[1].id); expect(grid.editState.sheetId).toBe(id);
    grid.setEditText('=SUM(Owner');
    const input = grid.el.querySelector('.grid-editor');
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    expect([...grid.el.querySelectorAll('.fx-item .fx-name')].map((n) => n.textContent)).toEqual(['OwnerOnly']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(grid.editState.text).toBe('=SUM(OwnerOnly');
    grid.setEditText('=SUM(OwnerOnly)'); grid.commitEdit(); expect(wb.getValue(id, 0, 0)).toBe(30);
  } finally { grid.destroy(); }
});

it('offers the displayed foreign sheet as a qualified reference target', async () => {
  const { wb, id, grid } = setup();
  try {
    await flush(); grid.beginEdit({ text: '=SUM(', mode: 'type' });
    grid.setSheet(wb.sheets[1].id); grid.setEditText('=SUM(Two');
    const input = grid.el.querySelector('.grid-editor');
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    expect(grid.el.querySelector('.fx-item .fx-name')?.textContent).toBe('Two Data');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(grid.editState.text).toBe("=SUM('Two Data'!");
    grid.setEditText("=SUM('Two Data'!Rate)"); grid.commitEdit(); expect(wb.getValue(id, 0, 0)).toBe(20);
  } finally { grid.destroy(); }
});

it('offers columns from the table containing the edited cell', async () => {
  const { wb, id, grid } = setup();
  try {
    for (const [i, s] of wb.sheets.entries()) {
      wb.setInput(s.id, 0, 0, i ? 'Foreign' : 'Amount'); wb.setInput(s.id, 0, 1, 'Result');
      wb.setInput(s.id, 1, 0, i ? '40' : '30');
      wb.addTable(s.id, { r1: 0, c1: 0, r2: 1, c2: 1 }, { name: i ? 'Source' : 'Sales' });
    }
    await flush();
    grid.setSelection({ anchor: { r: 1, c: 1 }, focus: { r: 1, c: 1 }, active: { r: 1, c: 1 } });
    grid.beginEdit({ text: '=SUM(', mode: 'type' });
    grid.setSheet(wb.sheets[1].id); grid.setEditText('=SUM([Am');
    const input = grid.el.querySelector('.grid-editor');
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true })); await flush();
    expect(grid.el.querySelector('.fx-item .fx-name')?.textContent).toBe('Amount');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(grid.editState.text).toBe('=SUM([Amount]');
    grid.setEditText('=SUM([Amount])'); grid.commitEdit(); expect(wb.getValue(id, 1, 1)).toBe(30);
    wb.undo(); expect(wb.getValue(id, 1, 1)).toBeNull();
  } finally { grid.destroy(); }
});
