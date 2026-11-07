// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  Element.prototype.setPointerCapture = function setPointerCapture() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

function mount(prepare) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'x'.repeat(40)); // 280px of text in a 100px column: spills over B and C
  prepare?.(wb, id);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  vi.runOnlyPendingTimers();
  return { wb, id, grid, label: document.querySelector('#gc-0-0') };
}

// A spilling label painted the surface colour across the blank cells it ran over, so a neighbour
// with a fill of its own, or one a rule painted, lost its colour under the text.
describe('a label spilling over a painted blank cell', () => {
  it('keeps its opaque backing only up to the first painted neighbour', () => {
    const { label } = mount((wb, id) => { wb.applyStyle(id, { r1: 0, c1: 1, r2: 0, c2: 1 }, { bg: '#ffcc00' }); });
    expect(label.classList.contains('spill')).toBe(true);
    expect(label.style.width).toBe('300px'); // the text still runs across B and C
    expect(label.classList.contains('spill-over-fill')).toBe(true);
    expect(label.style.getPropertyValue('--spill-opaque')).toBe('100px');
    expect(document.querySelector('#gc-0-1').style.backgroundColor).not.toBe('');
  });

  it('measures the backing to the painted cell wherever it is', () => {
    const { label } = mount((wb, id) => { wb.applyStyle(id, { r1: 0, c1: 2, r2: 0, c2: 2 }, { bg: '#ffcc00' }); });
    expect(label.style.width).toBe('300px');
    expect(label.style.getPropertyValue('--spill-opaque')).toBe('200px');
  });

  it('treats a cell a rule paints as painted', () => {
    const { label } = mount((wb, id) => { wb.addRule(id, { range: { r1: 0, c1: 1, r2: 0, c2: 1 }, type: 'empty', style: { bg: '#00ccff' } }); });
    expect(label.style.width).toBe('300px');
    expect(label.style.getPropertyValue('--spill-opaque')).toBe('100px');
  });

  it('carries its own fill colour in the backing', () => {
    const { label } = mount((wb, id) => {
      wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 1 }, { bg: '#ffcc00' });
    });
    expect(label.classList.contains('spill-over-fill')).toBe(true);
    expect(label.style.getPropertyValue('--spill-opaque')).toBe('100px');
    expect(label.style.getPropertyValue('--spill-bg')).not.toBe('');
    expect(label.style.backgroundColor).toBe('');
  });

  it('stays fully opaque over unpainted neighbours, as before', () => {
    const { label } = mount();
    expect(label.classList.contains('spill')).toBe(true);
    expect(label.classList.contains('spill-over-fill')).toBe(false);
    expect(label.style.getPropertyValue('--spill-opaque')).toBe('');
  });
});
