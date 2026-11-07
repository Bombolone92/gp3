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

// With Option held, a Mac keyboard reports the character the key types (√ for V), so the Paste
// special chord is recognised by the physical key as well.
it('opens Paste special on the modifier with Alt and the V key, whatever character the chord reports', () => {
  const wb = new Workbook();
  const commands = [];
  const grid = createGrid({ wb, sheetId: wb.sheets[0].id, announce() {}, onCommand: (cmd, arg) => commands.push([cmd, arg]) });
  document.body.replaceChildren(grid.el);
  try {
    const viewport = grid.el.querySelector('.grid-viewport');
    expect(key(viewport, '√', { ...mod, altKey: true, code: 'KeyV' })).toBe(false);
    expect(commands.map(([cmd]) => cmd)).toEqual(['pasteSpecialMenu']);
    expect(commands[0][1]).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(key(viewport, 'v', { ...mod, altKey: true, code: 'KeyV' })).toBe(false);
    expect(commands).toHaveLength(2);
    expect(grid.editing).toBe(false);
  } finally { grid.destroy(); }
});
