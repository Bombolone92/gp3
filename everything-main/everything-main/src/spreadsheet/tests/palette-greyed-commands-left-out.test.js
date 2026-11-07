// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { paletteCommands } from '../src/ui/palette.js';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The palette offered Merge cells for a single cell, More and Fewer decimal places for a date,
// time, text or custom format, and Undo and Redo with nothing to undo or redo, where the menus
// grey those items out because the commands do nothing: an enabled row that did nothing, in
// silence. The palette now leaves them out on the same flags the menus grey them by.
describe('palette commands', () => {
  const has = (flags, cmd, arg = undefined) => paletteCommands(flags).some((c) => c.cmd === cmd && (arg === undefined || c.arg === arg));

  it('leave out the merges the Format menu greys out', () => {
    expect(has({ singleCell: true }, 'merge')).toBe(false);
    expect(has({ singleCell: true }, 'mergeAcross')).toBe(false);
    expect(has({ singleCell: true }, 'mergeDown')).toBe(false);
    expect(has({ singleCell: false }, 'merge')).toBe(true);
    expect(has({ singleCell: false, oneRow: true }, 'mergeAcross')).toBe(true);
    expect(has({ singleCell: false, oneRow: true }, 'mergeDown')).toBe(false);
    expect(has({ singleCell: false, oneCol: true }, 'mergeAcross')).toBe(false);
    expect(has({ singleCell: false, oneCol: true }, 'mergeDown')).toBe(true);
    // A merged cell on its own is not a single cell to the flags; Unmerge cells is offered as the menu offers it.
    expect(paletteCommands({ merged: true, singleCell: false }).find((c) => c.cmd === 'merge').label).toBe('Unmerge cells');
  });

  it('leave out the decimal steps for formats without decimals, and Undo and Redo with nothing to take back', () => {
    for (const fmt of ['date', 'time', 'datetime', 'text', 'custom']) {
      expect(has({ style: { fmt } }, 'dec', 1), fmt).toBe(false);
      expect(has({ style: { fmt } }, 'dec', -1), fmt).toBe(false);
    }
    for (const style of [{}, { fmt: 'number' }, { fmt: 'percent' }]) expect(has({ style }, 'dec', 1)).toBe(true);
    expect(has({ canUndo: false }, 'undo')).toBe(false);
    expect(has({ canRedo: false }, 'redo')).toBe(false);
    expect(has({ canUndo: true, canRedo: true }, 'undo')).toBe(true);
    expect(has({}, 'redo')).toBe(true);
  });

  it('agree with the menus: whatever the menus grey out for a state, the palette leaves out', () => {
    for (const flags of [{ singleCell: true }, { singleCell: false, oneRow: true }, { style: { fmt: 'date' } }, { canUndo: false, canRedo: false }]) {
      const greyed = menubarMenus(flags).flatMap((m) => menuLeaves(m.items)).filter((it) => it.disabled && it.cmd).map((it) => `${it.cmd}:${JSON.stringify(it.arg)}`);
      const offered = paletteCommands(flags).map((c) => `${c.cmd}:${JSON.stringify(c.arg)}`);
      for (const key of greyed) expect(offered, key).not.toContain(key);
    }
  });
});

describe('the palette in the editor', () => {
  let view;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    Element.prototype.scrollIntoView = () => {};
    Element.prototype.scrollTo = () => {};
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => { document.querySelector('.palette-root')?.remove(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('has no Merge cells for a single date cell, and no decimal steps either', async () => {
    const doc = new Doc({ name: 'Palette', path: 'Spreadsheets/Palette.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '2024-01-15');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const viewport = view.el.querySelector('.grid-viewport');
    viewport.focus();
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    const input = document.querySelector('.palette-input');
    expect(input).not.toBeNull();
    const search = async (text) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); await vi.advanceTimersByTimeAsync(1); };
    await search('merge cells');
    expect(document.querySelector('.palette-empty').textContent).toBe('No action matches that');
    await search('decimal places');
    expect(document.querySelector('.palette-empty').textContent).toBe('No action matches that');
    await search('bold');
    expect([...document.querySelectorAll('.palette-item')].map((n) => n.getAttribute('aria-label'))).toContain('Bold');
  });
});
