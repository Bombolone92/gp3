// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import { workbookFromFile, sheetToHtml } from '../src/core/io.js';
import { buildPrintTable } from '../src/ui/print.js';
import { defaultCellFormatFile } from './helpers/default-cell-format.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));

it('allows table shading over the shared Normal fill while No fill clears to paper', async () => {
  const wb = await workbookFromFile(defaultCellFormatFile({ normalFillId: 2, defaultFontId: 0, defaultBorderId: 0, numFmt: 0, alignment: '' }));
  const id = wb.activeSheetId;
  wb.setInput(id, 1, 0, 'One'); wb.setInput(id, 1, 1, 'Two');
  wb.addTable(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  const grid = createGrid({ wb, sheetId: id }); document.body.append(grid.el); await flush();
  try {
    const clear = grid.el.querySelector('#gc-0-0'), shared = grid.el.querySelector('#gc-0-1');
    expect(clear.style.backgroundColor).toBe('var(--surface, #ffffff)');
    expect(clear.classList.contains('filled')).toBe(false);
    expect(shared.style.backgroundColor).toBe('rgb(68, 114, 196)');
    const table = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
    expect(table.rows[0].cells[0].style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(table.rows[0].cells[0].classList.contains('filled')).toBe(false);
    expect(table.rows[0].cells[1].style.backgroundColor).toBe('rgb(68, 114, 196)');
    const html = new DOMParser().parseFromString(sheetToHtml(wb, id), 'text/html');
    expect(html.querySelectorAll('td')[0].getAttribute('style')).toContain('mso-pattern:auto');
    expect(html.querySelectorAll('td')[1].style.backgroundColor).toBe('rgb(68, 114, 196)');
    wb.addRule(id, { type: 'notEmpty', range: { r1: 0, c1: 1, r2: 0, c2: 1 }, style: { bg: 'transparent' } });
    await flush();
    const conditionalClear = grid.el.querySelector('#gc-0-1');
    expect(conditionalClear.style.backgroundColor).toBe('var(--surface, #ffffff)');
    expect(conditionalClear.classList.contains('filled')).toBe(false);
    const clearedPrint = buildPrintTable(wb, id, { range: { r1: 0, c1: 0, r2: 1, c2: 1 } });
    expect(clearedPrint.rows[0].cells[1].style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(clearedPrint.rows[0].cells[1].classList.contains('filled')).toBe(false);
  } finally { grid.destroy(); }
});

// A table's style is the base coat: its bands and header colours lie under a cell's own fill,
// and Filter and Sort by colour read the cell's own fill. The grid painted the coat over it.
it('paints a cell\'s own fill over the table band and header, and a rule\'s fill over both', async () => {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  [['Name', 'Qty', 'Unit'], ['a', '1', 'x'], ['b', '2', 'y'], ['c', '3', 'z']].forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
  wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 2 }); // banded, the blue style: rows 2 and 4 carry the band
  wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { bg: '#ff0000' });
  wb.applyStyle(id, { r1: 1, c1: 2, r2: 1, c2: 2 }, { bg: '#ff0000' });
  wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { bg: '#00ff00' });
  wb.addRule(id, { range: { r1: 1, c1: 1, r2: 1, c2: 2 }, type: 'notEmpty', style: { bg: '#0000ff' } });
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  const bg = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`).style.backgroundColor;
  expect(bg(1, 0)).toBe('rgb(255, 0, 0)'); // its own fill, not the band
  expect(bg(0, 0)).toBe('rgb(0, 255, 0)'); // its own fill, not the header colour
  expect(bg(1, 1)).toBe('rgb(0, 0, 255)'); // the rule over the band
  expect(bg(1, 2)).toBe('rgb(0, 0, 255)'); // the rule over the cell's own fill
  expect(bg(3, 1)).toBe('rgb(217, 225, 242)'); // the band where nothing else paints
  expect(bg(0, 1)).toBe('rgb(68, 114, 196)'); // the header colour where nothing else paints
  grid.destroy();
});
