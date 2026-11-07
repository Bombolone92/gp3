// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { menubarMenus, menuLeaves } from '../src/ui/menubar.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Format › Alignment compared the cell's `valign` against 'top', 'middle' and 'bottom', but Middle is the
// default and is stored as no `valign` at all, so all three radio items read aria-checked="false" on an
// ordinary cell — and choosing Middle left them that way. The toolbar's own menu already ticks Middle.
const leaf = (menus, label) => menuLeaves(menus.find((m) => m.id === 'format').items).find((it) => it.label === label);
const checks = (style) => {
  const menus = menubarMenus({ style });
  return ['Top', 'Middle', 'Bottom'].map((label) => !!leaf(menus, label).checked);
};

describe('menu definitions', () => {
  it('ticks Middle for a cell with no vertical alignment of its own', () => {
    expect(checks({})).toEqual([false, true, false]);
    expect(checks({ valign: 'middle' })).toEqual([false, true, false]);
    expect(checks({ valign: 'top' })).toEqual([true, false, false]);
    expect(checks({ valign: 'bottom' })).toEqual([false, false, true]);
  });
});

describe('the Format menu on screen', () => {
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

  it('marks one of Top, Middle and Bottom at all times, including after Middle is chosen', async () => {
    const doc = new Doc({ name: 'Align', path: 'Spreadsheets/Align.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, 'x');
    view = editorView({ doc, goHome() {}, openPath() {}, newDoc() {}, importFile() {} });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(1);
    const item = (label) => [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label);
    const openAlignment = async () => {
      view.el.querySelector('[data-menu="format"]').click();
      item('Alignment').click();
      await vi.advanceTimersByTimeAsync(1);
      return ['Top', 'Middle', 'Bottom'].map((label) => item(label).getAttribute('aria-checked'));
    };
    expect(await openAlignment()).toEqual(['false', 'true', 'false']);
    item('Bottom').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(await openAlignment()).toEqual(['false', 'false', 'true']);
    item('Middle').click();
    await vi.advanceTimersByTimeAsync(1);
    expect(wb.getCell(id, 0, 0).s?.valign).toBeUndefined();
    expect(await openAlignment()).toEqual(['false', 'true', 'false']);
    closeMenu();
  });
});
