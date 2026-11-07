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
  const wb = new Workbook();
  const commands = [];
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id, announce() {}, onCommand: (cmd, arg) => commands.push([cmd, arg]) });
  document.body.replaceChildren(grid.el);
  return { grid, commands, viewport: grid.el.querySelector('.grid-viewport') };
}

const CHORDS = [['!', 'Digit1', 'number'], ['@', 'Digit2', 'time'], ['#', 'Digit3', 'date'], ['$', 'Digit4', 'currency'], ['%', 'Digit5', 'percent'], ['^', 'Digit6', 'scientific'], ['~', 'Backquote', 'general']];

// ⌘+Shift+3, 4 and 5 are macOS's own screenshot chords and never reach the page, so the date, currency
// and percent formats had no working shortcut on a Mac. These chords now answer on Control too.
it('takes the number-format and border chords from Control+Shift on a Mac as well as from the command key', async () => {
  const { grid, commands, viewport } = await setup('MacIntel');
  try {
    for (const [k, code, fmt] of CHORDS) {
      expect(key(viewport, k, { code, ctrlKey: true, shiftKey: true }), k).toBe(false);
      expect(commands.pop()).toEqual(['fmt', fmt]);
    }
    key(viewport, '&', { code: 'Digit7', ctrlKey: true, shiftKey: true });
    expect(commands.pop()).toEqual(['borders', 'outer']);
    key(viewport, '_', { code: 'Minus', ctrlKey: true, shiftKey: true });
    expect(commands.pop()).toEqual(['borders', 'none']);
    // A layout where Shift+4 is not $ still reaches the currency format through the physical key.
    key(viewport, '4', { code: 'Digit4', ctrlKey: true, shiftKey: true });
    expect(commands.pop()).toEqual(['fmt', 'currency']);
    // The command key keeps the chords macOS leaves to the page.
    key(viewport, '!', { code: 'Digit1', metaKey: true, shiftKey: true });
    expect(commands.pop()).toEqual(['fmt', 'number']);
    expect(commands).toEqual([]);
    expect(grid.editing).toBe(false);
  } finally { grid.destroy(); }
});

it('keeps Control+Shift+digit as the format chord elsewhere, by the reported key or the physical one', async () => {
  const { grid, commands, viewport } = await setup('Win32');
  try {
    key(viewport, '$', { code: 'Digit4', ctrlKey: true, shiftKey: true });
    key(viewport, '4', { code: 'Digit4', ctrlKey: true, shiftKey: true });
    key(viewport, '&', { code: 'Digit7', ctrlKey: true, shiftKey: true });
    expect(commands).toEqual([['fmt', 'currency'], ['fmt', 'currency'], ['borders', 'outer']]);
    // The command key is not the shortcut modifier here: the chord is not typing either.
    expect(key(viewport, '$', { code: 'Digit4', metaKey: true, shiftKey: true })).toBe(true);
    expect(commands).toHaveLength(3);
    expect(grid.editing).toBe(false);
  } finally { grid.destroy(); }
});
