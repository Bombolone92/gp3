// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGrid } from '../src/ui/grid.js';
import { Workbook } from '../src/core/workbook.js';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  // Every UTF-16 unit measures 7px, so an emoji is 14px wide and a combining mark adds 7px.
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); });

const flush = () => new Promise((r) => setTimeout(r, 5));

/** Double-click the text in A2 `x` pixels from where it starts and report where the caret landed. */
async function caretAt(text, x) {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 1, 0, text);
  const grid = createGrid({ wb, sheetId: id });
  document.body.replaceChildren(grid.el);
  await flush();
  grid.viewport.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 4 + x, clientY: 26 + 13 }));
  const editor = grid.el.querySelector('.grid-editor');
  const at = editor.selectionStart;
  grid.cancelEdit();
  grid.destroy();
  return at;
}

describe('the caret placed by a double-click', () => {
  it('never lands between the halves of a surrogate pair', async () => {
    expect(await caretAt('ab😀cd', 20)).toBe(2); // left half of the emoji: before it
    expect(await caretAt('ab😀cd', 22)).toBe(4); // right half: after it
    expect(await caretAt('ab😀cd', 37)).toBe(5);
  });

  it('keeps a combining mark with its base letter', async () => {
    expect(await caretAt('aéb', 12)).toBe(1);
    expect(await caretAt('aéb', 16)).toBe(3);
  });
});
