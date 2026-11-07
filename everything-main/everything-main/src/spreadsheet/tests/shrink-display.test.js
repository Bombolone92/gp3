// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable, buildPrintRoot, preparePrintRoot } from '../src/ui/print.js';
import { openFormatCellsDialog } from '../src/ui/formatcells.js';
import { closeAllModals } from '../src/ui/modal.js';

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', id => clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ font: '', measureText(text) {
    return { width: text.length * Number(/([\d.]+)px/.exec(this.font)?.[1] || 13) / 2 };
  } });
  Element.prototype.scrollTo = () => {};
});
afterEach(() => { closeAllModals(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
function fixture(style = {}) {
  const wb = new Workbook(), id = wb.activeSheetId;
  wb.setInput(id, 0, 0, 'A long synthetic cell label');
  wb.setInput(id, 0, 1, '=123456.75*2');
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, { size: 20, ...style });
  wb.applyStyle(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { fmt: 'custom', code: '0.00' });
  wb.setColWidth(id, 0, 80); wb.setColWidth(id, 1, 80); wb.clearHistory();
  return { wb, id };
}
it('shrinks labels and formatted numbers in the grid, grows with width, and leaves formulas unchanged', async () => {
  const { wb, id } = fixture({ shrink: true }); const before = wb.toJSON();
  const grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el); await flush();
  const cell = c => grid.el.querySelector(`.cell[data-r="0"][data-c="${c}"]`);
  const narrow = parseFloat(cell(0).style.fontSize);
  expect(narrow).toBeGreaterThan(0); expect(narrow).toBeLessThan(20);
  expect(cell(0).classList.contains('spill')).toBe(false);
  expect(cell(1).textContent).toBe('246913.50'); expect(cell(1).textContent).not.toBe('###');
  const displayed = wb.toJSON(); delete displayed.sheets[0].viewSelection;
  expect(displayed).toEqual(before);
  wb.setColWidth(id, 0, 400); await flush(); expect(parseFloat(cell(0).style.fontSize)).toBe(20);
  wb.undo(); await flush(); expect(parseFloat(cell(0).style.fontSize)).toBeCloseTo(narrow, 3);
  expect(wb.getCell(id, 0, 1).f).toBe('123456.75*2'); expect(wb.styleAt(id, 0, 0).size).toBe(20);
  grid.destroy();
});
it('keeps wrapping dominant and preserves ordinary numeric overflow without Shrink', async () => {
  const { wb, id } = fixture({ shrink: true, wrap: true });
  const grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el); await flush();
  expect(grid.el.querySelector('.cell[data-r="0"][data-c="0"]').style.fontSize).toBe('20px');
  expect(grid.el.querySelector('.cell[data-r="0"][data-c="1"]').textContent).toBe('###');
  grid.destroy();
});
it('prints shrunk text and rich font runs without spill or losing the stored font', () => {
  const { wb, id } = fixture({ shrink: true });
  const cell = wb.getCell(id, 0, 0);
  cell.richText = [{ text: 'A long synthetic cell label', s: { size: 30, bold: true } }];
  const before = wb.toJSON(); const table = buildPrintTable(wb, id);
  const cells = table.querySelectorAll('td');
  expect(parseFloat(cells[0].style.fontSize)).toBeLessThan(20);
  expect(parseFloat(cells[0].querySelector('.rich-text-run').style.fontSize)).toBeLessThan(30);
  expect(cells[0].classList.contains('spill')).toBe(false);
  expect(cells[1].textContent).toBe('246913.50'); expect(wb.toJSON()).toEqual(before);
});
it('refits formatted print text at the measured content width instead of producing hashes', () => {
  const { wb, id } = fixture({ shrink: true });
  const root = buildPrintRoot(wb, id, 'Shrink fixture', { fit: 'scale', scale: 100, title: false });
  document.body.append(root);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = this.classList.contains('number-format-layout') ? 40 : 160;
    return { width, height: 26, left: 0, right: width, top: 0, bottom: 26 };
  });
  preparePrintRoot(root);
  expect(root.querySelectorAll('td')[1].textContent).toBe('246913.50');
  expect(parseFloat(root.querySelectorAll('td')[1].style.fontSize)).toBeLessThan(10);
});
function dialog(style = {}, protectedRange = false) {
  const { wb, id } = fixture(style), range = { r1: 0, c1: 0, r2: 0, c2: 1 };
  if (protectedRange) { wb.protectRange(id, range, 'Synthetic'); wb.clearHistory(); }
  const before = wb.toJSON();
  const run = vi.fn((cmd, { patch }) => wb.transaction('Format cells', () => wb.applyStyle(id, range, patch)));
  const modal = openFormatCellsDialog({ wb, sheetId: () => id, range: () => range, active: () => ({ r: 0, c: 0 }),
    style: () => wb.styleAt(id, 0, 0), grid: {}, run }, { panel: 'align' });
  const field = [...modal.panel.querySelectorAll('label')].find(n => n.textContent === 'Shrink to fit').querySelector('input');
  const apply = () => modal.panel.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
  return { wb, id, before, modal, field, run, apply };
}
it('applies Shrink as one Undo, without changing font size, values or formulas', () => {
  const { wb, id, before, field, apply, run } = dialog(); field.click(); apply();
  expect(run).toHaveBeenCalledWith('applyFormat', { patch: { shrink: true }, border: null });
  expect(wb.undoLabels()).toHaveLength(1); expect(wb.styleAt(id, 0, 1).size).toBe(20);
  expect(wb.getValue(id, 0, 1)).toBe(246913.5); wb.undo(); expect(wb.toJSON()).toEqual(before);
});
it('retains a checked Shrink preference while wrapping disables it', () => {
  const { modal, field, run, apply } = dialog({ shrink: true, wrap: true });
  expect(field.checked).toBe(true); expect(field.disabled).toBe(true);
  const wrap = modal.panel.querySelector('[aria-label="Text wrapping"]');
  wrap.value = 'overflow'; wrap.dispatchEvent(new Event('change', { bubbles: true }));
  expect(field.disabled).toBe(false); expect(field.checked).toBe(true);
  apply(); expect(run).toHaveBeenCalledWith('applyFormat', { patch: { wrap: null, clip: null }, border: null });
});
it('preserves Cancel and protected cells for Shrink drafts', () => {
  const cancelled = dialog(); cancelled.field.click(); cancelled.modal.close();
  expect(cancelled.run).not.toHaveBeenCalled(); expect(cancelled.wb.toJSON()).toEqual(cancelled.before);
  const protectedCells = dialog({}, true); protectedCells.field.click(); protectedCells.apply();
  expect(protectedCells.wb.toJSON()).toEqual(protectedCells.before); expect(protectedCells.wb.canUndo()).toBe(false);
});
it('refits a retained Shrink preview when its tab becomes visible and disconnects on close', () => {
  let resize; const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { resize = callback; }
    observe() {}
    disconnect() { disconnect(); }
  });
  const { modal } = dialog({ shrink: true });
  const preview = modal.panel.querySelector('[aria-label="Alignment preview"]');
  Object.defineProperty(preview, 'clientWidth', { configurable: true, value: 100 });
  Object.defineProperty(preview.querySelector('span'), 'scrollWidth', { configurable: true, value: 400 });
  modal.panel.querySelector('[data-key="font"]').click();
  modal.panel.querySelector('[data-key="align"]').click();
  expect(preview.querySelector('span').style.fontSize).toBe('5px');
  Object.defineProperty(preview, 'clientWidth', { value: 200 }); resize();
  expect(preview.querySelector('span').style.fontSize).toBe('10px');
  modal.close(); expect(disconnect).toHaveBeenCalledOnce();
});
