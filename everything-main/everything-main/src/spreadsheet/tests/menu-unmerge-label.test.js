// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { paletteCommands } from '../src/ui/palette.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// On a merged cell the Format menu offered "Merge all", enabled, and running it unmerged the cell;
// the cell menu already said "Unmerge cells" there. The menus and the palette now say what will happen.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

it('labels the merge item Unmerge cells when the selection holds merged cells', () => {
  const mergeItems = (flags) => menuLeaves(menubarMenus(flags).find((m) => m.id === 'format').items).filter((it) => it.cmd === 'merge');
  expect(mergeItems({ singleCell: false }).map((it) => [it.label, !!it.disabled])).toEqual([['Merge and center', false]]);
  expect(mergeItems({ singleCell: true }).map((it) => [it.label, !!it.disabled])).toEqual([['Merge and center', true]]);
  expect(mergeItems({ merged: true }).map((it) => [it.label, !!it.disabled])).toEqual([['Unmerge cells', false]]);
  expect(paletteCommands({}).find((c) => c.cmd === 'merge').label).toBe('Merge cells');
  expect(paletteCommands({ merged: true }).find((c) => c.cmd === 'merge').label).toBe('Unmerge cells');
});

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
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('tells the Format menu about the merged cell under the selection', async () => {
  const doc = new Doc({ name: 'Merged', path: 'Spreadsheets/Merged.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 1 });
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
  view.el.querySelector('[data-menu="format"]').click();
  item('Merge cells').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(item('Unmerge cells')).toBeTruthy();
  expect(item('Merge and center')).toBeUndefined();
  closeMenu();
  view.goTo('Sheet1!D4');
  await vi.advanceTimersByTimeAsync(1);
  view.el.querySelector('[data-menu="format"]').click();
  item('Merge cells').click();
  await vi.advanceTimersByTimeAsync(1);
  expect(item('Merge and center')).toBeTruthy();
  expect(item('Merge and center').disabled).toBe(true); // one plain cell: nothing to merge
});
