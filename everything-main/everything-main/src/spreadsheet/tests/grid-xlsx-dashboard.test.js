// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintSheet } from '../src/ui/print.js';
import { openTextBoxDialog } from '../src/ui/textboxdialog.js';
import { closeAllModals } from '../src/ui/modal.js';
import { dashboardXlsx } from './helpers/xlsx-dashboard-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { closeAllModals(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 20));

it('renders and prints image cells and live labels, scales text at imported zoom, and edits/undoes a linked label', async () => {
  const wb = await workbookFromFile(dashboardXlsx()), sheet = wb.activeSheet;
  const grid = createGrid({ wb, sheetId: sheet.id });
  document.body.append(grid.el);
  try {
    grid.setZoom(.81, true);
    await flush();
    const label = () => grid.el.querySelector('.text-body');
    expect(grid.zoom).toBe(.81);
    expect(label().textContent).toBe('10 calls');
    expect(parseFloat(label().style.fontSize)).toBeCloseTo(sheet.charts[0].style.size * .81);
    expect(grid.el.querySelector('#gc-0-0 img')).not.toBeNull();
    expect(grid.el.querySelectorAll('.chart-body svg')).toHaveLength(2);
    wb.setInput(wb.sheets[0].id, 0, 1, '17');
    await flush();
    expect(label().textContent).toBe('17 calls');
    expect(buildPrintSheet(wb, sheet.id).querySelector('.text-body').textContent).toBe('17 calls');
    const dialog = openTextBoxDialog({ wb, sheetId: () => sheet.id, grid, active: () => ({ r: 0, c: 0 }) }, { textbox: sheet.charts[0] });
    const area = dialog.panel.querySelector('textarea');
    expect(area.value).toBe('17 calls');
    area.value = 'Manual caption';
    dialog.panel.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();
    expect(label().textContent).toBe('Manual caption');
    expect(sheet.charts[0].textRef).toBeUndefined();
    wb.undo();
    await flush();
    expect(label().textContent).toBe('17 calls');
  } finally { grid.destroy(); }
});
