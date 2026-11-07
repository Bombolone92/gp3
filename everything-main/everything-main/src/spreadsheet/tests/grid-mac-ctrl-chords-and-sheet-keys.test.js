// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLCanvasElement.prototype.getContext = () => ({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = function scrollTo() {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
});
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.resetModules(); });

const key = (target, k, init = {}) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

/** The grid as it loads on the given platform: the modifier key is decided when its module is evaluated. */
async function setup(platform) {
  vi.stubGlobal('navigator', { platform, userAgent: platform === 'MacIntel' ? 'Macintosh' : 'Windows' });
  vi.resetModules();
  const { createGrid } = await import('../src/ui/grid.js');
  const { Workbook } = await import('../src/core/workbook.js');
  const S = await import('../src/core/selection.js');
  const wb = new Workbook();
  const id = wb.sheets[0].id;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) wb.setInput(id, r, c, `${r}${c}`);
  wb.addValidation(id, { range: { r1: 6, c1: 0, r2: 6, c2: 0 }, type: 'list', source: 'yes, no' });
  const commands = [];
  const lists = [];
  const grid = createGrid({ wb, sheetId: id, announce() {}, onCommand: (cmd, arg) => commands.push([cmd, arg]), onListOpen: (o) => lists.push(o) });
  document.body.replaceChildren(grid.el);
  return { wb, id, grid, S, commands, lists, viewport: grid.el.querySelector('.grid-viewport') };
}

// On a Mac, ⌘+Space is Spotlight and ⌘+` switches windows, so selecting a column or showing formulas
// had no working chord there. Such chords now answer on Control too, as the format chords here already do.
it('takes Control+Space, Control+Shift+Space and Control+` on a Mac beside the command key', async () => {
  const { grid, S, commands, viewport } = await setup('MacIntel');
  try {
    grid.setSelection(S.single(1, 1));
    key(viewport, ' ', { ctrlKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 1, r2: 1048575, c2: 1 });
    expect(grid.active).toEqual({ r: 1, c: 1 });
    grid.setSelection(S.single(1, 1));
    key(viewport, ' ', { ctrlKey: true, shiftKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 2, c2: 1 }); // the block of data first, as Ctrl+A
    key(viewport, '`', { ctrlKey: true, code: 'Backquote' });
    expect(commands.pop()).toEqual(['showFormulas', undefined]);
    key(viewport, '`', { metaKey: true, code: 'Backquote' }); // the command key still works where the system lets it through
    expect(commands.pop()).toEqual(['showFormulas', undefined]);
    grid.setSelection(S.single(1, 0));
    key(viewport, ' ', { metaKey: true });
    expect(grid.range).toEqual({ r1: 0, c1: 0, r2: 1048575, c2: 0 });
  } finally { grid.destroy(); }
});

// Ctrl+PgUp/PgDn switch the browser's own tabs in Chrome and Firefox, so the sheets need a chord the
// browser does not own: Alt+Right and Alt+Left (Option on a Mac).
for (const platform of ['Win32', 'MacIntel']) {
  it(`switches sheets with Alt+Right and Alt+Left on ${platform}, keeping Ctrl/Cmd+PgUp/PgDn`, async () => {
    const { grid, S, commands, lists, viewport } = await setup(platform);
    try {
      grid.setSelection(S.single(2, 0));
      key(viewport, 'ArrowRight', { altKey: true });
      expect(commands.pop()).toEqual(['sheet', 'next']);
      key(viewport, 'ArrowLeft', { altKey: true });
      expect(commands.pop()).toEqual(['sheet', 'prev']);
      // Alt+Down on a plain cell offers the pick list.
      key(viewport, 'ArrowDown', { altKey: true });
      expect(commands.pop()).toEqual(['pickFromList', undefined]);
      expect(grid.active).toEqual({ r: 2, c: 0 }); // the active cell has not moved
      key(viewport, 'PageDown', { ctrlKey: platform === 'Win32', metaKey: platform === 'MacIntel' });
      expect(commands.pop()).toEqual(['sheet', 'next']);
      // Alt+Down on a dropdown cell still opens its list.
      grid.setSelection(S.single(6, 0));
      key(viewport, 'ArrowDown', { altKey: true });
      expect(lists).toHaveLength(1);
      expect(commands).toEqual([]);
      key(viewport, 'ArrowLeft', { altKey: true });
      expect(commands.pop()).toEqual(['sheet', 'prev']);
      // Alt+Shift+Down still stretches the selection, and a plain arrow still steps.
      grid.setSelection(S.single(2, 0));
      key(viewport, 'ArrowDown', { altKey: true, shiftKey: true });
      expect(grid.range).toEqual({ r1: 2, c1: 0, r2: 3, c2: 0 });
      expect(commands).toEqual([]);
    } finally { grid.destroy(); }
  });
}
