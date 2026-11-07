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
const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const mod = { ctrlKey: true, metaKey: true };

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, '1');
  wb.setInput(id, 1, 0, '2');
  const first = wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, anchor: { r: 1, c: 2 }, dx: 10, dy: 5, w: 300, h: 200 });
  const second = wb.addChart(id, { type: 'text', text: 'Note', anchor: { r: 10, c: 1 }, w: 200, h: 60 });
  const commands = [];
  const announced = [];
  const grid = createGrid({ wb, sheetId: id, announce: (t) => announced.push(t), onCommand: (c, a) => commands.push([c, a]) });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, first, second, commands, announced, viewport: grid.viewport };
}

describe('charts from the keyboard', () => {
  it('are selected in turn with Ctrl+Alt+O (Shift goes back) and let go with Escape', async () => {
    const { grid, first, second, announced, viewport } = setup();
    await flush();
    expect(grid.selectedChart).toBe(null);
    key(viewport, 'o', { ...mod, altKey: true, code: 'KeyO' });
    expect(grid.selectedChart).toBe(first);
    expect(announced.at(-1)).toMatch(/selected/);
    key(viewport, 'o', { ...mod, altKey: true, code: 'KeyO' });
    expect(grid.selectedChart).toBe(second);
    key(viewport, 'o', { ...mod, altKey: true, code: 'KeyO' });
    expect(grid.selectedChart).toBe(first); // round again
    key(viewport, 'o', { ...mod, altKey: true, shiftKey: true, code: 'KeyO' });
    expect(grid.selectedChart).toBe(second);
    key(viewport, 'Escape');
    expect(grid.selectedChart).toBe(null);
    grid.destroy();
  });

  it('nudge the selected chart with the arrows, a whole cell with Shift, in undoable steps', async () => {
    const { wb, id, grid, first, viewport } = setup();
    await flush();
    grid.selectChart(first);
    key(viewport, 'ArrowRight');
    expect(wb.chartById(id, first)).toMatchObject({ anchor: { r: 1, c: 2 }, dx: 18, dy: 5 });
    expect(wb.undoLabel()).toBe('Move chart');
    key(viewport, 'ArrowDown');
    key(viewport, 'ArrowUp');
    key(viewport, 'ArrowLeft');
    expect(wb.chartById(id, first)).toMatchObject({ anchor: { r: 1, c: 2 }, dx: 10, dy: 5 });
    key(viewport, 'ArrowRight', { shiftKey: true });
    expect(wb.chartById(id, first)).toMatchObject({ anchor: { r: 1, c: 3 }, dx: 10, dy: 5 });
    key(viewport, 'ArrowDown', { shiftKey: true });
    expect(wb.chartById(id, first)).toMatchObject({ anchor: { r: 2, c: 3 }, dx: 10, dy: 5 });
    expect(grid.selectedChart).toBe(first); // the arrows did not leave the chart
    expect(grid.active).toEqual({ r: 0, c: 0 }); // nor move the cell cursor
    grid.destroy();
  });

  it('copy the selected chart with Ctrl+C rather than the cells behind it', async () => {
    const { grid, first, commands, viewport } = setup();
    await flush();
    grid.selectChart(first);
    const e = new KeyboardEvent('keydown', { key: 'c', ...mod, bubbles: true, cancelable: true });
    viewport.dispatchEvent(e);
    expect(commands.at(-1)).toEqual(['copyChart', { id: first }]);
    expect(e.defaultPrevented).toBe(true);
    grid.destroy();
  });
});
