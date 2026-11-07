// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('an open cell edit', () => {
  it.each(['menubar', 'topbar', 'toolbar'])('survives focus moving to a button in the %s, so insert-at-caret commands can act on it', (area) => {
    const wb = new Workbook();
    const id = wb.sheets[0].id;
    wb.setInput(id, 0, 0, 'existing text');
    const grid = createGrid({ wb, sheetId: id });
    const button = document.createElement('button');
    const bar = document.createElement('div');
    bar.className = area;
    bar.append(button);
    document.body.replaceChildren(grid.el, bar);
    vi.runOnlyPendingTimers();
    grid.beginEdit({ text: 'existing text', mode: 'edit' });
    expect(grid.editing).toBe(true);
    const editor = grid.el.querySelector('.grid-editor');
    button.focus(); // the browser focuses the clicked button and blurs the editor
    editor.dispatchEvent(new FocusEvent('blur'));
    vi.runOnlyPendingTimers();
    expect(grid.editing).toBe(true);
    expect(wb.getValue(id, 0, 0)).toBe('existing text');
    // Focus leaving the app altogether still commits.
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    editor.dispatchEvent(new FocusEvent('blur'));
    vi.runOnlyPendingTimers();
    expect(grid.editing).toBe(false);
    grid.destroy();
  });
});
