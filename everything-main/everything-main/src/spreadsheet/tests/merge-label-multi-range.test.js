// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// With several ranges selected (Ctrl/Cmd+click adds them), the Format menu, the palette, the toolbar
// button and the cell menu read the merge state from the last range (the toolbar from the active cell
// alone), so they offered "Merge cells" while the command, which looks at every range, unmerged. They
// now agree with the command; and several single cells, which merge nothing, grey the item out.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', (fn) => setTimeout(fn, 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.scrollTo = () => {};
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);

async function open(merges) {
  const doc = new Doc({ name: 'Merges', path: 'Spreadsheets/Merges.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  for (const range of merges) wb.mergeCells(id, range);
  wb.clearHistory();
  view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  // Columns are 100px wide and rows 26px high in jsdom; a Ctrl+click (or Ctrl+drag) adds a range.
  const pe = (type, r, c, init = {}) => viewport.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: c * 100 + 50, clientY: r * 26 + 13, pointerId: 7, button: 0, pointerType: 'mouse', ...init }));
  const select = async (first, ...more) => {
    view.goTo(`Sheet1!${first}`);
    await vi.advanceTimersByTimeAsync(1);
    for (const rg of more) {
      pe('pointerdown', rg.r1, rg.c1, { ctrlKey: true, metaKey: true });
      if (rg.r2 !== rg.r1 || rg.c2 !== rg.c1) pe('pointermove', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
      pe('pointerup', rg.r2, rg.c2, { ctrlKey: true, metaKey: true });
    }
    await vi.advanceTimersByTimeAsync(1);
    expect(view.el.querySelector('.status-left .status-item').textContent.split(', ')).toHaveLength(more.length + 1);
  };
  const formatMenuItem = async () => {
    view.el.querySelector('[data-menu="format"]').click();
    item('Merge cells').click();
    await vi.advanceTimersByTimeAsync(1);
    const found = item('Unmerge cells') || item('Merge and center');
    return { label: found.querySelector('.menu-label').textContent, disabled: !!found.disabled, click: () => found.click() };
  };
  const paletteLabel = async () => {
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(1);
    const input = document.querySelector('.palette-input');
    input.value = 'merge cells';
    input.dispatchEvent(new Event('input'));
    const label = [...document.querySelectorAll('.palette-item')].map((n) => n.textContent).find((t) => /merge cells/i.test(t));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.advanceTimersByTimeAsync(1);
    return label;
  };
  const cellMenuLabel = async () => {
    viewport.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 13, button: 2 }));
    await vi.advanceTimersByTimeAsync(1);
    item('Format').click();
    await vi.advanceTimersByTimeAsync(1);
    const label = (item('Unmerge cells') || item('Merge cells')).querySelector('.menu-label').textContent;
    closeMenu();
    return label;
  };
  const cellMenuMerge = async () => {
    viewport.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 13, button: 2 }));
    await vi.advanceTimersByTimeAsync(1);
    item('Format').click();
    await vi.advanceTimersByTimeAsync(1);
    const found = item('Unmerge cells') || item('Merge cells');
    const state = { label: found.querySelector('.menu-label').textContent, disabled: !!found.disabled };
    closeMenu();
    return state;
  };
  const toolbar = () => view.el.querySelector('.tb-btn[data-cmd="merge"]');
  return { wb, id, select, formatMenuItem, paletteLabel, cellMenuLabel, cellMenuMerge, toolbar };
}

it('says Unmerge cells everywhere when an added range holds the merge, and unmerging is what happens', async () => {
  const { wb, id, select, formatMenuItem, paletteLabel, cellMenuLabel, toolbar } = await open([{ r1: 0, c1: 0, r2: 1, c2: 1 }]);
  await select('A1', { r1: 0, c1: 3, r2: 0, c2: 3 }, { r1: 0, c1: 4, r2: 0, c2: 4 });
  expect(toolbar().title).toBe('Unmerge cells');
  expect(toolbar().getAttribute('aria-pressed')).toBe('true');
  expect(toolbar().getAttribute('aria-label')).toBe('Merge & Center'); // the ribbon names it by its label
  expect(toolbar().disabled).toBe(false);
  expect(await paletteLabel()).toMatch(/Unmerge cells/);
  expect(await cellMenuLabel()).toBe('Unmerge cells');
  const menuItem = await formatMenuItem();
  expect(menuItem).toMatchObject({ label: 'Unmerge cells', disabled: false });
  menuItem.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(id).merges).toHaveLength(0);
});

it('says Unmerge cells on the toolbar when the range holds a merge the active cell is outside of', async () => {
  const { select, toolbar } = await open([{ r1: 2, c1: 2, r2: 3, c2: 3 }]);
  await select('A1:D4');
  expect(toolbar().title).toBe('Unmerge cells');
  expect(toolbar().getAttribute('aria-pressed')).toBe('true');
});

it('greys merging out for several single cells, which merge nothing', async () => {
  const { select, formatMenuItem, toolbar } = await open([]);
  await select('A1', { r1: 0, c1: 3, r2: 0, c2: 3 });
  expect(toolbar().title).toBe('Merge cells');
  expect(toolbar().disabled).toBe(true);
  expect(await formatMenuItem()).toMatchObject({ label: 'Merge and center', disabled: true });
});

it('greys the cell menu\'s Merge cells out for several single cells, as the Format menu does, and offers it for a block', async () => {
  const { select, cellMenuMerge } = await open([]);
  await select('A1', { r1: 0, c1: 3, r2: 0, c2: 3 });
  expect(await cellMenuMerge()).toEqual({ label: 'Merge cells', disabled: true });
  await select('A1:B2');
  expect(await cellMenuMerge()).toEqual({ label: 'Merge cells', disabled: false });
  // The cell menu read only the last range: a block with a single cell added after it looked like nothing to merge,
  // though the command merges the block.
  await select('A1:B2', { r1: 0, c1: 3, r2: 0, c2: 3 });
  expect(await cellMenuMerge()).toEqual({ label: 'Merge cells', disabled: false });
});

it('offers Merge cells for one plain block, as before', async () => {
  const { select, formatMenuItem, toolbar } = await open([]);
  await select('A1:B2');
  expect(toolbar().title).toBe('Merge cells');
  expect(toolbar().disabled).toBe(false);
  expect(await formatMenuItem()).toMatchObject({ label: 'Merge and center', disabled: false });
});
