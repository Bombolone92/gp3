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

const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

/** Two sheets; the sheet command does what the editor does with it: commits a plain entry, keeps a formula wanting a reference, and shows the other sheet. */
function setup() {
  const wb = new Workbook();
  const one = wb.sheets[0].id;
  const two = wb.addSheet('Two').id;
  const commands = [];
  let grid;
  const onCommand = (cmd, arg) => {
    commands.push({ cmd, arg, editing: grid.editing, text: grid.editState?.text });
    if (cmd !== 'sheet') return;
    if (grid.editing && !grid.acceptsRef() && !grid.commitEdit()) return;
    grid.setSheet(grid.sheetId === one ? two : one);
  };
  grid = createGrid({ wb, sheetId: one, announce() {}, onCommand });
  document.body.replaceChildren(grid.el);
  return { wb, one, two, grid, commands, editor: grid.el.querySelector('.grid-editor') };
}

// Alt+Up and Alt+Down are the documented next and previous sheet chords, and the ready-mode keys
// switch sheets on them, but while a cell was being edited only Ctrl/Cmd+PgUp/PgDn was handled:
// Alt+Down after "=SUM(" picked a reference (=SUM(A2) and after "abc" committed the entry and moved down.
describe('Alt+Up and Alt+Down while a cell is edited', () => {
  it('show the next or previous sheet with a formula\'s edit kept alive and its text unchanged', () => {
    const { one, two, grid, commands, editor } = setup();
    grid.beginEdit({ text: '=SUM(', mode: 'type' });
    key(editor, 'ArrowDown', { altKey: true });
    expect(commands).toEqual([{ cmd: 'sheet', arg: 'next', editing: true, text: '=SUM(' }]);
    expect(grid.sheetId).toBe(two);
    expect(grid.editing).toBe(true);
    expect(grid.editState.text).toBe('=SUM(');
    key(editor, 'ArrowUp', { altKey: true });
    expect(commands[1]).toEqual({ cmd: 'sheet', arg: 'prev', editing: true, text: '=SUM(' });
    expect(grid.sheetId).toBe(one);
    expect(grid.editState.text).toBe('=SUM(');
    grid.cancelEdit();
    grid.destroy();
  });

  it('hand a plain entry to the sheet command too, instead of committing it and moving down', () => {
    const { wb, one, two, grid, commands, editor } = setup();
    grid.beginEdit({ text: 'abc', mode: 'type' });
    key(editor, 'ArrowDown', { altKey: true });
    expect(commands).toEqual([{ cmd: 'sheet', arg: 'next', editing: true, text: 'abc' }]);
    expect(grid.sheetId).toBe(two);
    expect(wb.getValue(one, 0, 0)).toBe('abc'); // committed by the command's own handling, in place
    expect(wb.getValue(one, 1, 0)).toBeNull();
    grid.destroy();
  });

  it('take the same chord from the formula bar, and leave Alt with Shift or Ctrl to the other handlers', () => {
    const { grid, commands } = setup();
    grid.beginEdit({ text: '=SUM(', mode: 'type' });
    grid.handleEditKey(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, cancelable: true }));
    expect(commands.map((x) => x.cmd)).toEqual(['sheet']);
    grid.handleEditKey(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, shiftKey: true, cancelable: true }));
    grid.handleEditKey(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, ctrlKey: true, cancelable: true }));
    expect(commands.map((x) => x.cmd)).toEqual(['sheet']);
    grid.cancelEdit();
    grid.destroy();
  });
});
