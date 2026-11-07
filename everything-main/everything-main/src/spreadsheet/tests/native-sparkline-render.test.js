// @vitest-environment jsdom
import { expect, it, beforeEach } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function () {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = id => clearTimeout(id);
});
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
const setup = (text = false) => {
  const wb = new Workbook({ sheets: [{ id: 's', name: 'S', sparklineGroups: [{ high: true, low: true, colorSeries: { rgb: 'FF115599' }, colorHigh: { rgb: 'FF220044' }, colorLow: { rgb: 'FF330066' }, sparklines: [{ ref: 'D1', formula: 'A1:C1' }] }] }] });
  [1, 4, 2].forEach((v, c) => wb.setInput('s', 0, c, String(v)));
  if (text) wb.setInput('s', 0, 3, 'Note');
  const grid = createGrid({ wb, sheetId: 's' }); document.body.replaceChildren(grid.el);
  return { wb, grid };
};
it.each([false, true])('draws native metadata on a cell, preserving text=%s, fills, borders and accessibility', async text => {
  const { wb, grid } = setup(text);
  try {
    wb.applyStyle('s', { r1: 0, c1: 3, r2: 0, c2: 3 }, { bg: '#ffdd00' });
    await flush();
    const cell = grid.el.querySelector('#gc-0-3'), graph = cell.querySelector('.native-sparkline');
    expect(graph).not.toBeNull(); expect(graph.getAttribute('role')).toBe('img');
    expect(graph.getAttribute('aria-label')).toContain('3 values');
    expect(graph.querySelector('path').getAttribute('stroke')).toBe('#115599');
    expect(cell.textContent).toBe(text ? 'Note' : ''); expect(wb.getValue('s', 0, 3)).toBe(text ? 'Note' : null);
    const printed = buildPrintTable(wb, 's').querySelectorAll('tbody tr')[0].children[3];
    expect(printed.textContent).toBe(text ? 'Note' : ''); expect(printed.querySelector('.native-sparkline svg')).not.toBeNull();
    expect(printed.style.backgroundColor).toBe('rgb(255, 221, 0)');
  } finally { grid.destroy(); }
});
it('updates native plots after editing source data and undo, with grid/print SVG parity', async () => {
  const { wb, grid } = setup();
  // The screen draws a row in whole pixels and print at its exact height; a whole-pixel row gives
  // both the same box, so the drawings themselves can be compared.
  wb.setRowHeight('s', 0, 24);
  try {
    await flush();
    const svg = () => grid.el.querySelector('#gc-0-3 .native-sparkline svg').outerHTML;
    const before = svg(); wb.setInput('s', 0, 1, '0'); await flush(); const after = svg();
    expect(after).not.toBe(before);
    const printed = buildPrintTable(wb, 's').querySelector('.native-sparkline svg').outerHTML;
    expect(printed).toBe(after);
    wb.undo(); await flush(); expect(svg()).toBe(before);
  } finally { grid.destroy(); }
});
it('keeps formula-based sparklines working alongside native decorations', async () => {
  const { wb, grid } = setup();
  try {
    wb.setInput('s', 1, 3, '=SPARKLINE(A1:C1,"column")'); await flush();
    expect(grid.el.querySelector('#gc-1-3.sparkline svg')).not.toBeNull();
    expect(grid.el.querySelector('#gc-0-3.has-native-sparkline svg')).not.toBeNull();
  } finally { grid.destroy(); }
});
