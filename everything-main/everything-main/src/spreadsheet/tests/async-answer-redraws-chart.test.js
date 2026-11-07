// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

// An answer from IMPORTRANGE or AI lands without anything being edited, so wb.version stands still.
// The engine announced it as an ordinary cell change, which every listener that keeps a picture of
// the values — the charts, the find bar's list of matches — compares against wb.version: the cells
// beside the chart showed the answer while the chart still showed the empty picture it drew from
// #BUSY!, and stayed that way until the user happened to type something. It is announced as a
// recalculation now, the same news F9 gives, which those listeners already treat as stale.

const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe('an answer arriving from an outside source', () => {
  it('is announced as a recalculation, without moving the workbook version', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const answer = deferred();
    wb.setAsyncProvider('IMPORTRANGE', () => answer.promise);
    wb.setInput(id, 0, 0, '=IMPORTRANGE("Book","Sheet1!A1")');
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
    const version = wb.version;
    const types = [];
    wb.addEventListener('change', (e) => types.push(e.detail.type));
    answer.resolve(42);
    await tick();
    expect(wb.getValue(id, 0, 0)).toBe(42);
    expect(types).toContain('recalc');
    // doc.js compares wb.version to decide whether a save is still current and a restore safe.
    expect(wb.version).toBe(version);
  });

  it('is announced again when F9 asks the sources afresh', async () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setAsyncProvider('AI', async () => 'first');
    wb.setInput(id, 0, 0, '=AI("q")');
    expect(wb.getValue(id, 0, 0)).toEqual({ error: '#BUSY!' });
    await tick();
    expect(wb.getValue(id, 0, 0)).toBe('first');
    const types = [];
    wb.addEventListener('change', (e) => types.push(e.detail.type));
    const version = wb.version;
    expect(wb.clearAsyncCache()).toBe(true);
    expect(types).toEqual(['recalc']);
    expect(wb.version).toBe(version);
    // Nothing to forget, nothing to announce.
    types.length = 0;
    expect(wb.clearAsyncCache()).toBe(false);
    expect(types).toEqual([]);
  });

  it('makes a chart over the imported data draw its picture again', async () => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
    HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
    Element.prototype.scrollTo = function scrollTo() {};
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
    globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
    globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
    const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

    const wb = new Workbook();
    const id = wb.sheets[0].id;
    const answer = deferred();
    wb.setAsyncProvider('IMPORTRANGE', () => answer.promise);
    wb.setInput(id, 0, 0, 'a');
    wb.setInput(id, 1, 0, 'b');
    wb.setInput(id, 0, 1, '=IMPORTRANGE("Book","Sheet1!A1")');
    wb.setInput(id, 1, 1, '=IMPORTRANGE("Book","Sheet1!A2")');
    wb.addChart(id, { type: 'column', range: { r1: 0, c1: 0, r2: 1, c2: 1 }, anchor: { r: 4, c: 4 }, w: 300, h: 200 });
    const grid = createGrid({ wb, sheetId: id });
    document.body.replaceChildren(grid.el);
    await flush();
    const box = grid.el.querySelector('.chart-box');
    const busy = box.querySelector('svg');
    expect(busy).not.toBeNull();

    answer.resolve(7);
    await tick();
    await flush();
    expect(wb.getValue(id, 0, 1)).toBe(7);
    expect(box.querySelector('svg')).not.toBe(busy);
    grid.destroy();
    document.body.replaceChildren();
  });
});

afterEach(() => { document.body.replaceChildren(); });
beforeEach(() => {});
