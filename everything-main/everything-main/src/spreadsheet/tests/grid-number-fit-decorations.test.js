// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

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

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid };
}
const ICONS = { r1: 0, c1: 0, r2: 2, c2: 0 };

// The test canvas measures 7px a character. Plain list controls sit outside
// the active cell; an icon-set glyph still reserves space inside its cell.
describe('a number beside a decoration', () => {
  it('does not lose numeric precision or show ### because of a plain list control', async () => {
    const { grid } = await mount((wb, id) => {
      wb.setColWidth(id, 0, 50);
      wb.setInput(id, 0, 0, '12345');
      wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'list', source: '12345, 67890' });
      wb.setColWidth(id, 1, 70);
      wb.setInput(id, 0, 1, '1234.5678');
      wb.addValidation(id, { range: { r1: 0, c1: 1, r2: 0, c2: 1 }, type: 'list', source: '1234.5678, 1' });
    });
    expect(grid.el.querySelector('#gc-0-0').textContent).toBe('12345');
    expect(grid.el.querySelector('#gc-0-1').textContent).toBe('1234.5678');
    grid.destroy();
  });

  it('is shortened when it does not fit beside its icon', async () => {
    const { grid } = await mount((wb, id) => {
      wb.setColWidth(id, 0, 60);
      ['1000000', '2000000', '3000000'].forEach((v, r) => wb.setInput(id, r, 0, v));
      wb.addRule(id, { range: ICONS, type: 'icons', set: 'arrows', style: {} });
    });
    expect(grid.el.querySelector('#gc-2-0').textContent).toBe('▲3E+06'); // 44px beside the glyph: 3000000 is 49
    grid.destroy();
  });
});
