// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
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

const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const mod = navigator.platform.includes('Mac') ? { metaKey: true } : { ctrlKey: true };

function setup() {
  const wb = new Workbook();
  const commands = [];
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id, announce() {}, onCommand: (cmd, arg) => commands.push([cmd, arg]) });
  document.body.replaceChildren(grid.el);
  return { grid, commands, viewport: grid.el.querySelector('.grid-viewport') };
}

// Option+= on a US Mac keyboard reports ≠, and Ctrl with the numeric keypad's + reports + without
// Shift, so AutoSum and Insert rows were out of reach from those keys.
it('takes Alt+= for AutoSum by the physical key, in the grid and while editing', () => {
  const { grid, commands, viewport } = setup();
  expect(key(viewport, '≠', { altKey: true, code: 'Equal' })).toBe(false);
  expect(commands.pop()).toEqual(['autosum', undefined]);
  expect(grid.editing).toBe(false);
  grid.beginEdit({ text: 'x', mode: 'type' });
  const editor = grid.el.querySelector('.grid-editor');
  expect(key(editor, '≠', { altKey: true, code: 'Equal' })).toBe(false);
  expect(commands.pop()).toEqual(['autosum', undefined]);
  expect(grid.editing).toBe(true);
  grid.destroy();
});

it('opens Insert on Ctrl with the keypad plus, or a plus that needs no Shift (a single cell asks how to insert)', () => {
  const { commands, viewport } = setup();
  key(viewport, '+', { ...mod, code: 'NumpadAdd' });
  key(viewport, '+', { ...mod, code: 'BracketRight' }); // a layout with + on its own key
  key(viewport, '+', { ...mod, shiftKey: true, code: 'Equal' }); // the US chord, as before
  expect(commands).toEqual([['insertDialog', undefined], ['insertDialog', undefined], ['insertDialog', undefined]]);
});
