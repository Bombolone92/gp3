// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintTable } from '../src/ui/print.js';
import { single } from '../src/core/selection.js';
import { projectTrackerXlsx } from './helpers/xlsx-project-tracker-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 1900; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 1000; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
});
afterEach(() => document.body.replaceChildren());

it('draws the tracker colors, thin header sides and positioned checkboxes on screen and in print', async () => {
  const wb = await workbookFromFile(projectTrackerXlsx(), 'tracker.xlsx'), id = wb.activeSheetId;
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  try {
    document.body.append(grid.el);
    await new Promise(resolve => setTimeout(resolve, 20));
    const cell = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
    expect(cell(5, 2).style.backgroundColor).toBe('rgb(0, 176, 80)');
    expect(cell(6, 14).style.backgroundColor).toBe('rgb(0, 176, 80)');
    expect(cell(5, 3).style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(cell(3, 1).style.borderRightWidth).toBe('');
    expect(cell(3, 2).style.borderLeftWidth).toBe('1px'); // right cell owns the shared tie
    expect(cell(3, 1).style.borderBottomWidth).toBe('2px');
    expect(cell(1, 1).style.fontFamily).toContain('Century Gothic');
    expect(cell(1, 1).classList.contains('spill')).toBe(true);
    expect(cell(6, 1).classList.contains('excel-checkbox')).toBe(true);
    const box = () => cell(6, 1).querySelector('[role="checkbox"]');
    expect(box().getAttribute('aria-checked')).toBe('true');
    expect(box().style.left).toBe('16px');
    expect(box().style.width).toBe('13px');
    grid.setSelection(single(6, 1));
    grid.viewport.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    expect(wb.getValue(id, 6, 1)).toBe(false);
    wb.undo();
    expect(wb.getValue(id, 6, 1)).toBe(true);

    const table = buildPrintTable(wb, id);
    expect(table.querySelectorAll('svg[aria-label="Checked"]')).toHaveLength(1);
    expect(table.querySelectorAll('svg[aria-label="Unchecked"]')).toHaveLength(21);
    const printedBox = table.querySelector('svg[aria-label="Checked"]');
    expect(printedBox.getAttribute('width')).toBe('13');
    expect(printedBox.parentElement.style.paddingLeft).toBe('16px');
    const printedCell = text => [...table.querySelectorAll('td')].find(td => td.textContent === text);
    expect(printedCell('Complete').style.backgroundColor).toBe('rgb(0, 176, 80)');
    expect(printedCell('At Risk').style.borderBottomWidth).toBe('2px');
    expect(printedCell('At Risk').style.borderRightWidth).toBe('');
    expect(printedCell('Status').style.borderLeftWidth).toBe('1px');
  } finally { grid.destroy(); }
});
