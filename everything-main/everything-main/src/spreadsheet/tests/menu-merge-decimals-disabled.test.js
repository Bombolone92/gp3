// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The Format menu offered "Merge and center" for a single cell and "More/Fewer
// decimal places" for dates, times, text and custom formats, where the
// toolbar and the cell menu grey them out because the commands do nothing.
const leaf = (menus, label) => menuLeaves(menus.find((m) => m.id === 'format').items).find((it) => it.label === label);

describe('menu definitions', () => {
  it('disable merging for a single cell and decimal steps for formats without decimals', () => {
    const single = menubarMenus({ singleCell: true });
    for (const label of ['Merge and center', 'Merge horizontally', 'Merge vertically']) expect(leaf(single, label).disabled, label).toBe(true);
    const block = menubarMenus({ singleCell: false });
    for (const label of ['Merge and center', 'Merge horizontally', 'Merge vertically']) expect(leaf(block, label).disabled, label).toBeFalsy();
    for (const fmt of ['date', 'time', 'datetime', 'text', 'custom']) {
      const menus = menubarMenus({ style: { fmt } });
      expect(leaf(menus, 'More decimal places').disabled, fmt).toBe(true);
      expect(leaf(menus, 'Fewer decimal places').disabled, fmt).toBe(true);
    }
    for (const style of [{}, { fmt: 'number' }, { fmt: 'percent' }, { fmt: 'currency' }, { fmt: 'scientific' }]) {
      const menus = menubarMenus({ style });
      expect(leaf(menus, 'More decimal places').disabled, style.fmt).toBeFalsy();
      expect(leaf(menus, 'Fewer decimal places').disabled, style.fmt).toBeFalsy();
    }
  });

  it('disable merging vertically for one row and horizontally for one column, where the command does nothing', () => {
    const row = menubarMenus({ singleCell: false, oneRow: true, oneCol: false });
    expect(leaf(row, 'Merge and center').disabled).toBeFalsy();
    expect(leaf(row, 'Merge horizontally').disabled).toBeFalsy();
    expect(leaf(row, 'Merge vertically').disabled).toBe(true);
    const col = menubarMenus({ singleCell: false, oneRow: false, oneCol: true });
    expect(leaf(col, 'Merge and center').disabled).toBeFalsy();
    expect(leaf(col, 'Merge horizontally').disabled).toBe(true);
    expect(leaf(col, 'Merge vertically').disabled).toBeFalsy();
  });
});

describe('the editor', () => {
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
  afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('follows the selection and the active cell format', async () => {
    const doc = new Doc({ name: 'Menus', path: 'Spreadsheets/Menus.xlsx' });
    const wb = doc.wb;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '2024-05-01');
    wb.mergeCells(id, { r1: 3, c1: 0, r2: 3, c2: 1 });
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
    const select = async (text) => {
      const name = view.el.querySelector('[aria-label="Cell reference"]');
      name.value = text;
      name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(1);
    };
    const format = () => view.el.querySelector('[data-menu="format"]').click();

    // A1 alone: a typed date, so no decimals, and nothing to merge.
    format();
    item('Merge cells').click();
    expect(item('Merge and center').disabled).toBe(true);
    format(); // closes
    format();
    item('Number').click();
    expect(item('More decimal places').disabled).toBe(true);
    expect(item('Fewer decimal places').disabled).toBe(true);
    format();

    await select('B1:C2');
    format();
    item('Merge cells').click();
    expect(item('Merge and center').disabled).toBe(false);
    format();
    format();
    item('Number').click();
    expect(item('More decimal places').disabled).toBe(false);
    format();

    // One row: nothing to merge vertically; one column: nothing to merge horizontally.
    await select('B1:C1');
    format();
    item('Merge cells').click();
    expect(item('Merge horizontally').disabled).toBe(false);
    expect(item('Merge vertically').disabled).toBe(true);
    format();
    await select('B1:B3');
    format();
    item('Merge cells').click();
    expect(item('Merge horizontally').disabled).toBe(true);
    expect(item('Merge vertically').disabled).toBe(false);
    format();

    // A merged cell counts as a block: the item offers to unmerge it.
    await select('A4');
    format();
    item('Merge cells').click();
    expect(item('Merge and center')).toBeUndefined();
    expect(item('Unmerge cells').disabled).toBe(false);
  });
});
