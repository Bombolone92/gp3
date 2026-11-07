// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar } from '../src/ui/toolbar.js';
import { createStatusBar } from '../src/ui/statusbar.js';
import { closeMenu, isMenuOpen } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import * as S from '../src/core/selection.js';

// The zoom menu, the Undo history and the name box's names menu all sent focus to the grid whenever
// they closed, undoing the menu's own return of focus to whatever opened it: Escape from the zoom menu
// left the keyboard in the sheet instead of on the zoom button, and Escape from the names menu took the
// name box's typed text with it. Only a choice from the menu moves focus to the sheet now.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const keydown = (key) => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
const contextmenu = (t) => t.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

describe('the toolbar history and the zoom menu', () => {
  let viewport;
  const grid = () => ({ editing: false, zoom: 1, focus: () => viewport.focus() });
  beforeEach(() => {
    globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    viewport = document.createElement('div');
    viewport.tabIndex = 0;
    document.body.append(viewport);
  });
  afterEach(() => { closeMenu(); document.body.replaceChildren(); });

  it('leave focus on the Undo button after Escape and Tab, and hand it to the sheet after a choice', () => {
    const wb = new Workbook();
    wb.setInput(wb.activeSheetId, 0, 0, 'x');
    const runs = [];
    const toolbar = createToolbar({
      wb, run: (cmd, arg) => runs.push([cmd, arg]), activeCell: () => null, style: () => ({}), active: () => ({ r: 0, c: 0 }),
      range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: grid(), subscribe: () => () => {},
    });
    document.body.append(toolbar.el);
    const undo = toolbar.el.querySelector('[aria-label="Undo"]');
    undo.focus();
    contextmenu(undo);
    expect(isMenuOpen()).toBe(true);
    keydown('Escape');
    expect(isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(undo);
    contextmenu(undo);
    keydown('Tab');
    expect(document.activeElement).toBe(undo);
    contextmenu(undo);
    document.querySelector('.menu-item').click();
    expect(runs).toEqual([['undoSteps', 1]]);
    expect(document.activeElement).toBe(viewport);
  });

  it('leave focus on the zoom button after Escape, and hand it to the sheet after a choice', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    const range = { r1: 0, c1: 0, r2: 0, c2: 0 };
    const runs = [];
    const bar = createStatusBar({
      wb, sheetId: () => id, activeCell: () => wb.getCell(id, 0, 0), subscribe: () => () => {}, run: (cmd, arg) => runs.push([cmd, arg]),
      grid: { ...grid(), range, selection: { ...S.fromRange(range), active: { r: 0, c: 0 } } },
    });
    document.body.append(bar.el);
    const zoom = bar.el.querySelector('.zoom-label');
    zoom.focus();
    zoom.click();
    expect(isMenuOpen()).toBe(true);
    keydown('Escape');
    expect(isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(zoom);
    zoom.click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.trim() === '150%').click();
    expect(runs).toEqual([['zoomTo', 1.5]]);
    expect(document.activeElement).toBe(viewport);
  });
});

describe('the name box names menu', () => {
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
  afterEach(() => { closeMenu(); closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('gives the name box back, with its typed text, after Escape, and the sheet after a choice', async () => {
    const doc = new Doc({ name: 'Names', path: 'Spreadsheets/Names.xlsx' });
    const { wb } = doc;
    wb.defineName('Total', 'Sheet1!A1:A3');
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const nameBox = view.el.querySelector('.name-box');
    const viewport = view.el.querySelector('.grid-viewport');
    nameBox.focus();
    nameBox.value = 'Tot';
    nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
    expect(isMenuOpen()).toBe(true);
    keydown('Escape');
    await vi.advanceTimersByTimeAsync(1);
    expect(isMenuOpen()).toBe(false);
    expect(document.activeElement).toBe(nameBox);
    expect(nameBox.value).toBe('Tot');
    // The names button, when it opened the menu, is where Escape leaves the keyboard.
    const button = view.el.querySelector('.name-menu-btn');
    button.focus();
    button.click();
    keydown('Escape');
    expect(document.activeElement).toBe(button);
    // A choice jumps to the range and puts focus on the sheet.
    button.click();
    [...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Total')).click();
    await vi.advanceTimersByTimeAsync(1);
    expect(document.activeElement).toBe(viewport);
    expect(view.el.querySelector('.name-box').value).toBe('Total'); // the box names the picked range by its defined name
  });
});
