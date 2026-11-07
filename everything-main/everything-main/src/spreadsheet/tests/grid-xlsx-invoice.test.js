// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { workbookFromFile } from '../src/core/io.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintSheet } from '../src/ui/print.js';
import { invoiceXlsx } from './helpers/xlsx-invoice-fixture.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1200 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('draws all invoice rectangles at their imported size and uses Cambria on screen and in print', async () => {
  const wb = await workbookFromFile(invoiceXlsx(), 'invoice.xlsx'), sheet = wb.activeSheet;
  const grid = createGrid({ wb, sheetId: sheet.id });
  document.body.append(grid.el);
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    const boxes = [...grid.el.querySelectorAll('.text-box')];
    expect(boxes).toHaveLength(5);
    for (const [i, box] of boxes.entries()) {
      expect(parseFloat(box.style.width)).toBeCloseTo(sheet.charts[i].w);
      expect(parseFloat(box.style.height)).toBeCloseTo(sheet.charts[i].h);
      expect(box.classList.contains('borderless')).toBe(true);
    }
    expect(boxes[2].querySelector('.text-body').style.backgroundColor).toBe('rgb(237, 251, 220)');
    expect(parseFloat(boxes[2].style.width)).toBeCloseTo(20.415);
    expect(parseFloat(boxes[2].style.height)).toBeCloseTo(20.932);
    expect(grid.el.querySelector('#gc-4-1').style.fontFamily).toContain('Cambria');
    expect(grid.el.querySelector('#gc-0-1').style.backgroundColor).toBe('rgb(129, 211, 26)');
    const print = buildPrintSheet(wb, sheet.id, { fit: 'actual' });
    const printedBoxes = [...print.querySelectorAll('.print-text')];
    expect(printedBoxes).toHaveLength(5);
    expect(parseFloat(printedBoxes[2].style.height)).toBeCloseTo(20.932);
    expect(printedBoxes[2].querySelector('.text-body').style.backgroundColor).toBe('rgb(237, 251, 220)');
    const label = [...print.querySelectorAll('td')].find(td => td.textContent === 'Invoice #:');
    expect(label.style.fontFamily).toContain('Cambria');
  } finally { grid.destroy(); }
});
