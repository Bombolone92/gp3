// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

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
const YELLOW = 'rgb(255, 255, 0)';
const THICK = { color: '#ff0000', style: 'thick' };

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(12, 0));
  await flush();
  const node = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
  return { wb, id, grid, node, sides: (r, c) => ['bt', 'bl', 'bb', 'br'].filter((cls) => node(r, c).classList.contains(cls)) };
}

// A checkbox cell was built and returned before its fill, borders, conditional format and table
// band were drawn, so a "Done" column in a bordered, banded task table had bare boxes in it;
// picture and sparkline cells dropped their borders and fill the same way.
describe('a cell whose content is a checkbox, a picture or a sparkline', () => {
  it('keeps its fill and borders, as the text cell beside it does', async () => {
    const { node, sides } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, 'TRUE');
      wb.setInput(id, 0, 1, 'x');
      wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, { bg: '#ffff00' });
      wb.applyBorders(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, 'outer', THICK);
      wb.addValidation(id, { range: { r1: 0, c1: 0, r2: 0, c2: 0 }, type: 'checkbox' });
    });
    const box = node(0, 0);
    expect(box.classList.contains('checkbox')).toBe(true);
    expect(box.classList.contains('checked')).toBe(true);
    expect(box.querySelector('[role="checkbox"]').getAttribute('aria-checked')).toBe('true');
    expect(box.textContent).toBe(''); // the box stands for the value; no TRUE beside it
    expect(box.style.backgroundColor).toBe(YELLOW);
    expect(sides(0, 0)).toEqual(['bt', 'bl', 'bb']); // the right edge belongs to B1's outline, as for any pair of cells
    expect(box.style.borderBottomWidth).toBe('3px');
    expect(box.style.borderBottomColor).toBe('rgb(255, 0, 0)');
    expect(node(0, 1).style.backgroundColor).toBe(YELLOW);
    expect(sides(0, 1)).toEqual(['bt', 'bb', 'br']);
  });

  it('takes a table band and a rule\'s fill like its neighbours', async () => {
    const { node } = await mount((wb, id) => {
      for (const [r, row] of [['Task', 'Done'], ['a', 'TRUE'], ['b', 'FALSE'], ['c', 'TRUE']].entries()) row.forEach((v, c) => wb.setInput(id, r, c, v));
      wb.addTable(id, { r1: 0, c1: 0, r2: 3, c2: 1 });
      wb.addValidation(id, { range: { r1: 1, c1: 1, r2: 3, c2: 1 }, type: 'checkbox' });
      wb.setInput(id, 6, 0, 'TRUE');
      wb.addValidation(id, { range: { r1: 6, c1: 0, r2: 6, c2: 0 }, type: 'checkbox' });
      wb.addRule(id, { range: { r1: 6, c1: 0, r2: 6, c2: 0 }, type: 'notEmpty', style: { bg: '#ff0000' } });
    });
    const band = node(1, 0).style.backgroundColor;
    expect(band).not.toBe('');
    expect(node(1, 1).style.backgroundColor).toBe(band); // the box cell on the banded row
    expect(node(1, 1).classList.contains('checkbox')).toBe(true);
    expect(node(2, 1).style.backgroundColor).toBe(node(2, 0).style.backgroundColor); // and on the plain row
    expect(node(6, 0).style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(node(6, 0).classList.contains('checked')).toBe(true);
  });

  it('draws a picture and a sparkline inside the cell\'s fill and outline', async () => {
    const { node, sides } = await mount((wb, id) => {
      wb.setInput(id, 2, 0, '=SPARKLINE({1,2,3})');
      wb.setInput(id, 4, 0, '=IMAGE("data:image/png;base64,iVBORw0KGgo=")');
      for (const r of [2, 4]) {
        wb.applyStyle(id, { r1: r, c1: 0, r2: r, c2: 0 }, { bg: '#ffff00', wrap: true });
        wb.applyBorders(id, { r1: r, c1: 0, r2: r, c2: 0 }, 'outer', THICK);
      }
    });
    expect(node(2, 0).querySelector('svg')).toBeTruthy();
    expect(node(2, 0).classList.contains('sparkline')).toBe(true);
    expect(node(2, 0).style.backgroundColor).toBe(YELLOW);
    expect(sides(2, 0)).toEqual(['bt', 'bl', 'bb', 'br']);
    expect(node(2, 0).style.borderRightWidth).toBe('3px');
    expect(node(4, 0).querySelector('img')).toBeTruthy();
    expect(node(4, 0).classList.contains('img-cell')).toBe(true);
    expect(node(4, 0).style.backgroundColor).toBe(YELLOW);
    expect(sides(4, 0)).toEqual(['bt', 'bl', 'bb', 'br']);
    // Wrapping lays text out; a picture has none and stays centred in its cell.
    expect(node(2, 0).classList.contains('wrap')).toBe(false);
    expect(node(4, 0).classList.contains('wrap')).toBe(false);
  });
});
