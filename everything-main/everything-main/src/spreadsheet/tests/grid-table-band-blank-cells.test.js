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

/** A banded table A1:C5 with only its first column filled: B2:C5 hold no cell records at all. */
async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (const [r, row] of [['Name', 'Qty', 'Unit'], ['a'], ['b'], ['c'], ['d']].entries()) row.forEach((v, c) => wb.setInput(id, r, c, v));
  wb.addTable(id, { r1: 0, c1: 0, r2: 4, c2: 2 });
  prepare?.(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(12, 0));
  await flush();
  const node = (r, c) => grid.el.querySelector(`#gc-${r}-${c}`);
  return { wb, id, grid, node, prop: (r, c, name) => node(r, c).style.getPropertyValue(name) };
}

// A blank cell with no record was painted by a rule but never by a table, so the bands and header
// coat of a freshly made or half-filled table (its normal state while being typed into) showed on
// the filled cells alone, with holes where the row's other cells were.
describe('the blank cells of a banded table', () => {
  it('wear the band on a banded row and nothing on the plain one, like the filled cell beside them', async () => {
    const { wb, id, node } = await mount();
    expect(wb.sheet(id).cells.get('1,1')).toBeUndefined();
    const band = node(1, 0).style.backgroundColor;
    expect(band).not.toBe('');
    expect(node(1, 1).style.backgroundColor).toBe(band);
    expect(node(1, 2).style.backgroundColor).toBe(band);
    expect(node(1, 1).classList.contains('cf')).toBe(true);
    expect(node(2, 1).style.backgroundColor).toBe(node(2, 0).style.backgroundColor);
    expect(node(3, 2).style.backgroundColor).toBe(band);
    expect(node(5, 1).style.backgroundColor).toBe(''); // below the table, nothing
  });

  it('show the band under a label overflowing them from the filled cell', async () => {
    const { node, prop } = await mount((wb, id) => { wb.setInput(id, 1, 0, 'A long name that runs on past its cell'); });
    const label = node(1, 0);
    expect(label.classList.contains('spill')).toBe(true);
    expect(label.classList.contains('spill-over-fill')).toBe(true);
    expect(prop(1, 0, '--spill-own')).toBe('100px'); // the label's own band stays in its cell
    expect(prop(1, 0, '--spill-opaque')).toBe('100px'); // the backing stops where the painted neighbour begins
  });
});
