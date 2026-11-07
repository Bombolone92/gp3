// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';
import { stylesheet, declared } from './helpers/css.js';

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
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.addValidation(id, { range: { r1: 4, c1: 0, r2: 4, c2: 0 }, type: 'checkbox' });
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  return { wb, id, grid, cell: () => grid.el.querySelector('#gc-4-0') };
}

// A checkbox cell swapped its gridcell role for role=checkbox, right inside role=row: a row may
// only own cells, so the cell dropped out of the grid for assistive tech (column counts and grid
// navigation broke), and aria-colindex means nothing on a checkbox.
describe('a checkbox cell', () => {
  it('stays a gridcell of its row, with the checkbox as an element inside it', async () => {
    const { wb, id, grid, cell } = await mount();
    expect(cell().getAttribute('role')).toBe('gridcell');
    expect(cell().getAttribute('aria-colindex')).toBe('1');
    expect(cell().hasAttribute('aria-checked')).toBe(false);
    expect(cell().parentElement.getAttribute('role')).toBe('row');
    const box = cell().querySelector('[role="checkbox"]');
    expect(box).toBeTruthy();
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(cell().classList.contains('checkbox')).toBe(true);
    expect(cell().classList.contains('unchecked')).toBe(true);
    grid.setSelection(S.single(4, 0));
    key(grid.viewport, ' ');
    expect(wb.getValue(id, 4, 0)).toBe(true);
    await flush();
    expect(cell().getAttribute('role')).toBe('gridcell');
    expect(cell().querySelector('[role="checkbox"]').getAttribute('aria-checked')).toBe('true');
    expect(cell().classList.contains('checked')).toBe(true);
    grid.destroy();
  });

  it('draws the box on that inner element', () => {
    const css = stylesheet('grid.css');
    expect(declared(css, '.cell.checkbox .checkbox-box', false).width).toBe('15px');
    expect(declared(css, '.cell.checkbox.checked .checkbox-box', false).background).toBe('var(--accent)');
    expect(declared(css, '.cell.checkbox::before', false).width).toBeUndefined();
    expect(declared(css, '.cell.checkbox.checked .checkbox-box', 'forced-colors')['forced-color-adjust']).toBe('none');
  });
});
