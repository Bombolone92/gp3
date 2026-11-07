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

/** F4 pressed `times` with the caret at `caret` in a fresh edit of `text`; the texts after each press. */
function cycle(text, caret, times = 3) {
  const wb = new Workbook();
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id, announce() {}, onCommand() {} });
  document.body.replaceChildren(grid.el);
  try {
    grid.beginEdit({ text, mode: 'type' });
    const editor = grid.el.querySelector('.grid-editor');
    editor.setSelectionRange(caret, caret);
    const seen = [];
    for (let i = 0; i < times; i++) { key(editor, 'F4'); seen.push(editor.value); }
    return seen;
  } finally { grid.destroy(); }
}

// A whole-row reference carries fixed columns by nature, which read as the "$A1" state of the cycle,
// whose next step keeps the rows as they were: F4 on 2:3 did nothing, ever.
it('cycles a whole-row or whole-column reference between anchored and relative', () => {
  expect(cycle('=SUM(2:3)', 8)).toEqual(['=SUM($2:$3)', '=SUM(2:3)', '=SUM($2:$3)']);
  expect(cycle('=SUM($2:$3)', 8, 2)).toEqual(['=SUM(2:3)', '=SUM($2:$3)']);
  expect(cycle('=SUM(B:D)', 8)).toEqual(['=SUM($B:$D)', '=SUM(B:D)', '=SUM($B:$D)']);
  expect(cycle('=SUM($B:$D)', 8, 2)).toEqual(['=SUM(B:D)', '=SUM($B:$D)']);
});

it('still walks a cell reference through all four anchorings', () => {
  expect(cycle('=A1', 3, 4)).toEqual(['=$A$1', '=A$1', '=$A1', '=A1']);
  expect(cycle('=SUM(A1:B2)', 11, 4)).toEqual(['=SUM($A$1:$B$2)', '=SUM(A$1:B$2)', '=SUM($A1:$B2)', '=SUM(A1:B2)']);
});
