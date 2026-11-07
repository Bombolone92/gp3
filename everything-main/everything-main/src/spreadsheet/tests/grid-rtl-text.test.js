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
const HEBREW = 'שלום 123.';
const ARABIC = 'مرحبا بالعالم';

async function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  prepare(wb, id);
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  grid.setSelection(S.single(12, 0));
  await flush();
  return { wb, id, grid, node: (r, c) => grid.el.querySelector(`#gc-${r}-${c}`) };
}

// A cell whose text begins in Hebrew or Arabic was laid out left to right and left-aligned, so its
// trailing number and full stop sat at the wrong end. Such a cell is now laid
// out right to left and aligned to the right unless told otherwise.
describe('text that begins with a right-to-left letter', () => {
  it('is laid out right to left and aligned to its end, the right, when no alignment is set', async () => {
    const { node } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, HEBREW);
      wb.setInput(id, 1, 0, `123 ${ARABIC}`); // digits are weak: the first letter decides
      wb.setInput(id, 2, 0, 'hello שלום');
      wb.setInput(id, 3, 0, '4567');
    });
    expect(node(0, 0).getAttribute('dir')).toBe('rtl');
    expect(node(0, 0).classList.contains('al')).toBe(true); // flex-start is the right edge of an rtl box
    expect(node(1, 0).getAttribute('dir')).toBe('rtl');
    expect(node(2, 0).hasAttribute('dir')).toBe(false);
    expect(node(2, 0).classList.contains('al')).toBe(true);
    expect(node(3, 0).hasAttribute('dir')).toBe(false);
    expect(node(3, 0).classList.contains('ar')).toBe(true);
  });

  it('honours an alignment that is set, on the side named', async () => {
    const { node } = await mount((wb, id) => {
      wb.setInput(id, 0, 0, HEBREW);
      wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { align: 'left' });
      wb.setInput(id, 1, 0, HEBREW);
      wb.applyStyle(id, { r1: 1, c1: 0, r2: 1, c2: 0 }, { align: 'center' });
      wb.setInput(id, 2, 0, HEBREW);
      wb.applyStyle(id, { r1: 2, c1: 0, r2: 2, c2: 0 }, { align: 'right' });
    });
    expect(node(0, 0).getAttribute('dir')).toBe('rtl');
    expect(node(0, 0).classList.contains('ar')).toBe(true); // flex-end: the left edge of an rtl box
    expect(node(1, 0).classList.contains('ac')).toBe(true);
    expect(node(2, 0).classList.contains('al')).toBe(true);
  });

  it('overflows leftwards over empty neighbours, as right-aligned text does', async () => {
    const { node } = await mount((wb, id) => { wb.setInput(id, 4, 2, 'שלום '.repeat(8)); }); // 280px in a 100px column
    expect(node(4, 2).classList.contains('spill')).toBe(true);
    expect(node(4, 2).style.left).toBe('0px');
    expect(node(4, 2).style.width).toBe('300px');
  });

  it('is edited right to left, aligned to its end, while a formula stays left to right', async () => {
    const { grid } = await mount((wb, id) => { wb.setInput(id, 0, 0, HEBREW); wb.setInput(id, 1, 0, '=1+1'); wb.setInput(id, 2, 0, 'plain'); });
    const editor = grid.el.querySelector('.grid-editor');
    grid.setSelection(S.single(0, 0));
    grid.beginEdit();
    expect(editor.getAttribute('dir')).toBe('auto');
    expect(editor.style.textAlign).toBe('start');
    grid.cancelEdit();
    grid.setSelection(S.single(1, 0));
    grid.beginEdit();
    expect(editor.getAttribute('dir')).toBe('ltr');
    expect(editor.style.textAlign).toBe('left');
    grid.cancelEdit();
    grid.setSelection(S.single(2, 0));
    grid.beginEdit();
    expect(editor.getAttribute('dir')).toBe('auto'); // left-to-right text resolves to the left as before
    expect(editor.style.textAlign).toBe('start');
    grid.cancelEdit();
  });

  it('is shaped paragraph by paragraph in the editor by the stylesheet', () => {
    const css = stylesheet('grid.css');
    expect(declared(css, '.grid-editor', false)['unicode-bidi']).toBe('plaintext');
  });
});
