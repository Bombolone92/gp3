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

const key = (target, k, init = {}) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
};
// The ready-mode chords a browser also owns: reload, bookmark, tab switching and zoom.
const CHORDS = [['r'], ['d'], ['9', 'Digit9'], ['0', 'Digit0'], ['['], [']'], ['\\'], ['`', 'Backquote'], ['R', undefined, true], ['(', 'Digit9', true]];

function setup() {
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  wb.setInput(id, 0, 0, 'top');
  const commands = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (cmd, arg) => commands.push([cmd, arg]) });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, commands, viewport: grid.viewport, editor: grid.el.querySelector('.grid-editor') };
}

// While an entry was being typed, Ctrl/Cmd+R, D, 9, 0, [, ], \ and ` reached the browser: the page
// reloaded or a bookmark dialog opened mid-entry. Those chords now do nothing in edit mode.
describe('the ready-mode chords while an entry is typed', () => {
  it('are swallowed in the cell editor, leaving the entry as it was', () => {
    const { grid, commands, editor } = setup();
    grid.beginEdit({ text: 'abc', mode: 'inplace' });
    for (const [k, code, shift] of CHORDS) {
      const e = key(editor, k, { ctrlKey: true, metaKey: true, code, shiftKey: !!shift });
      expect(e.defaultPrevented, `Ctrl+${shift ? 'Shift+' : ''}${k}`).toBe(true);
    }
    expect(grid.editing).toBe(true);
    expect(grid.editState.text).toBe('abc');
    expect(commands).toEqual([]);
    grid.cancelEdit();
    grid.destroy();
  });

  it('are swallowed on the formula bar\'s path too, which hands its keys to the grid', () => {
    const { grid, commands } = setup();
    grid.beginEdit({ text: '=1+', mode: 'inplace' });
    const e = new KeyboardEvent('keydown', { key: 'r', ctrlKey: true, metaKey: true, bubbles: true, cancelable: true });
    grid.handleEditKey(e);
    expect(e.defaultPrevented).toBe(true);
    expect(grid.editing).toBe(true);
    expect(commands).toEqual([]);
    grid.cancelEdit();
    grid.destroy();
  });

  it('still run their commands in ready mode', () => {
    const { grid, commands, viewport } = setup();
    expect(key(viewport, 'd', { ctrlKey: true, metaKey: true }).defaultPrevented).toBe(true);
    expect(key(viewport, 'r', { ctrlKey: true, metaKey: true }).defaultPrevented).toBe(true);
    key(viewport, '9', { ctrlKey: true, metaKey: true, code: 'Digit9' });
    key(viewport, '`', { ctrlKey: true, metaKey: true, code: 'Backquote' });
    expect(commands).toEqual([['fillDown', undefined], ['fillRight', undefined], ['hide', 'row'], ['showFormulas', undefined]]);
    expect(grid.editing).toBe(false);
    grid.destroy();
  });
});
