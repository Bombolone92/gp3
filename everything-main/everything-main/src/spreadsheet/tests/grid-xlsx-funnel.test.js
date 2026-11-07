// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintSheet } from '../src/ui/print.js';
import { funnelXlsx } from './helpers/xlsx-funnel-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1200 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 25));

it('draws the funnel at its saved size in the grid and print, and redraws formulas and labels after edits', async () => {
  const wb = await workbookFromFile(funnelXlsx(), 'campaign.xlsx'), sheet = wb.sheets[0];
  const grid = createGrid({ wb, sheetId: sheet.id });
  document.body.append(grid.el);
  try {
    await flush();
    const box = grid.el.querySelector('.chart-box');
    expect(box.style.width).toBe('1352px');
    expect(parseFloat(box.style.height)).toBeCloseTo(570.2);
    expect(box.classList.contains('transparent')).toBe(true);
    expect(box.classList.contains('borderless')).toBe(true);
    expect(grid.el.querySelector('#gc-1-2').style.fontFamily).toContain('Century Gothic');
    const labels = () => [...box.querySelectorAll('.chart-data-label')].map(n => n.textContent);
    const areas = () => [...box.querySelectorAll('.chart-area')].map(n => n.getAttribute('d'));
    const original = areas();
    expect(original).toHaveLength(3);
    expect(labels()).toEqual(['100%', '40%', 'IDENTIFIED 250', 'WON 100']);
    expect(buildPrintSheet(wb, sheet.id).querySelectorAll('.chart-area')).toHaveLength(3);
    wb.setInput(sheet.id, 7, 3, '150');
    await flush();
    expect(areas()).not.toEqual(original);
    expect(labels()).toEqual(['100%', '60%', 'IDENTIFIED 250', 'WON 150']);
    wb.undo();
    await flush();
    expect(areas()).toEqual(original);
    expect(labels()).toContain('WON 100');
  } finally { grid.destroy(); }
});
