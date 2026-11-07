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

/** Column D starts 300px into the sheet and is 100px wide; each cell of column D holds a long text formula. */
async function mount() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 3, '=REPT("ab ",12)');
  wb.applyStyle(id, { r1: 0, c1: 3, r2: 0, c2: 3 }, { align: 'center' });
  wb.setInput(id, 2, 3, '=REPT("cd ",12)');
  wb.applyStyle(id, { r1: 2, c1: 3, r2: 2, c2: 3 }, { align: 'right' });
  wb.setInput(id, 4, 3, '=REPT("אב ",12)'); // its result reads right to left; no alignment set
  const grid = createGrid({ wb, sheetId: id, announce() {} });
  document.body.replaceChildren(grid.el);
  await flush();
  const box = (r) => { const n = document.getElementById(`gc-${r}-3`); return { cls: n.className, left: n.style.left, width: n.style.width, dir: n.getAttribute('dir'), text: n.textContent }; };
  return { wb, id, grid, box };
}

// Formula view rewrote the text and forced the left-aligned classes but left the alignment the
// geometry was worked out from as the result's: a centred or right-aligned text formula — and one
// whose result merely reads right to left — was drawn starting a column or two left of its own
// cell, over its neighbours' text.
describe('a text formula shown in formula view', () => {
  it('is laid out from its own cell, however its result is aligned', async () => {
    const { grid, box } = await mount();
    expect(box(0)).toMatchObject({ cls: 'cell ac spill', left: '200px', width: '300px' }); // centred over C1:E1
    expect(box(2)).toMatchObject({ cls: 'cell ar spill', left: '100px' });
    expect(box(4)).toMatchObject({ dir: 'rtl', left: '100px' });

    grid.setShowFormulas(true);
    await flush();
    for (const r of [0, 2, 4]) {
      const b = box(r);
      expect(b.cls).toBe('cell al formula-text spill');
      expect(b.left).toBe('300px'); // column D's own left edge
      expect(b.dir).toBe(null); // a formula reads left to right
      expect(b.text.startsWith('=REPT(')).toBe(true);
    }

    grid.setShowFormulas(false);
    await flush();
    expect(box(0)).toMatchObject({ cls: 'cell ac spill', left: '200px', width: '300px' });
    expect(box(2)).toMatchObject({ cls: 'cell ar spill', left: '100px' });
    expect(box(4)).toMatchObject({ dir: 'rtl', left: '100px' });
  });

  it('leaves a plain right-aligned value where it was', async () => {
    const { wb, id, grid, box } = await mount();
    wb.setInput(id, 2, 3, 'cd cd cd cd cd cd cd cd cd cd cd cd '); // no formula: the value is shown either way
    grid.setShowFormulas(true);
    await flush();
    const b = box(2);
    expect(b.cls).toBe('cell ar spill');
    expect(b.left).toBe('100px');
    expect(b.text.startsWith('cd')).toBe(true);
  });
});
