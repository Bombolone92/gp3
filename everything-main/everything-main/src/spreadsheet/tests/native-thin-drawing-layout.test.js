// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintSheet } from '../src/ui/print.js';
const src = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 100"><path d="M.5 0V100" stroke="black"/></svg>');
const make = () => new Workbook({ sheets: [{ name: 'Lines', charts: [{ type: 'image', src, drawingShape: true, border: false, anchor: { r: 0, c: 0 }, w: .4, h: 80 }] }] });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); document.head.replaceChildren(); });
it('does not consume thin artwork with transparent selection borders', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  const style = document.createElement('style'); style.textContent = readFileSync('src/styles/grid.css', 'utf8'); document.head.append(style);
  const wb = make(), grid = createGrid({ wb, sheetId: wb.activeSheetId, announce: () => {} }); document.body.append(grid.el);
  try {
    await new Promise(resolve => setTimeout(resolve, 5));
    const box = grid.el.querySelector('.image-box');
    expect(parseFloat(box.style.width)).toBe(.4);
    expect(getComputedStyle(box).borderLeftWidth).toBe('0px');
    grid.selectChart(wb.activeSheet.charts[0].id);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(getComputedStyle(box).borderLeftWidth).toBe('0px');
  } finally { grid.destroy(); }
});
it('preserves subpixel artwork width in printed output', () => {
  const wb = make(), print = buildPrintSheet(wb, wb.activeSheetId, { fit: 'actual' });
  expect(parseFloat(print.querySelector('.print-object').style.width)).toBe(.4);
});
