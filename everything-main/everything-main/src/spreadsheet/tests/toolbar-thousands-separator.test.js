// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToolbar, ACCOUNTING_CODE } from '../src/ui/toolbar.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';

// "Thousands separator" showed checked on an Automatic cell, whose 1234567.5 has no separator, and
// unchecking it turned the cell into a Number with two decimals; on an Accounting preset it replaced the
// preset with a Number format. The item now applies to the formats that group digits (Number, Currency,
// Percent), is greyed for the rest, and changes nothing but the grouping.
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() };
}
Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });

const thousands = () => [...document.querySelectorAll('.menu-item')].find((b) => b.querySelector('.menu-label')?.textContent === 'Thousands separator');

describe('the toolbar item', () => {
  afterEach(() => { closeMenu(); document.body.replaceChildren(); });

  function open(style) {
    const wb = new Workbook();
    const runs = [];
    const toolbar = createToolbar({
      wb, run: (cmd, arg) => runs.push([cmd, arg]), activeCell: () => null, style: () => style, active: () => ({ r: 0, c: 0 }),
      range: () => ({ r1: 0, c1: 0, r2: 0, c2: 0 }), sheetId: () => wb.activeSheetId, grid: { editing: false }, subscribe: () => () => {},
    });
    document.body.append(toolbar.el);
    toolbar.el.querySelector('.tb-fmt').click();
    return { item: thousands(), runs };
  }

  it('is checked for a grouped Number, Currency or Percent cell and unchecked once grouping is off', () => {
    for (const fmt of ['number', 'currency', 'percent']) {
      expect(open({ fmt }).item.getAttribute('aria-checked'), fmt).toBe('true');
      expect(open({ fmt }).item.disabled, fmt).toBe(false);
      expect(open({ fmt, group: false }).item.getAttribute('aria-checked'), fmt).toBe('false');
      document.body.replaceChildren();
    }
  });

  it('is unchecked and greyed for formats that never group: Automatic, Scientific, Plain text, dates and custom codes', () => {
    for (const style of [{}, { fmt: 'scientific' }, { fmt: 'text' }, { fmt: 'date' }, { fmt: 'custom', code: ACCOUNTING_CODE }, { fmt: 'custom', code: '0.0' }]) {
      const { item } = open(style);
      expect(item.getAttribute('aria-checked'), JSON.stringify(style)).toBe('false');
      expect(item.disabled, JSON.stringify(style)).toBe(true);
      expect(item.getAttribute('role')).toBe('menuitemcheckbox');
      document.body.replaceChildren();
    }
  });

  it('asks for the grouping alone, leaving the format to keep its decimals and currency', () => {
    let { item, runs } = open({ fmt: 'currency', cur: 'EUR', dec: 0 });
    item.click();
    expect(runs).toEqual([['fmt', { group: false }]]);
    document.body.replaceChildren();
    ({ item, runs } = open({ fmt: 'percent', dec: 1, group: false }));
    item.click();
    expect(runs).toEqual([['fmt', { group: null }]]);
  });
});

describe('in the editor', () => {
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

  it('turns the separator off and on again without touching the decimals or the currency', async () => {
    const doc = new Doc({ name: 'Grouping', path: 'Spreadsheets/Grouping.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '1234567.5');
    wb.applyStyle(id, { r1: 0, c1: 0, r2: 0, c2: 0 }, { fmt: 'currency', cur: 'EUR', dec: 0 });
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    const toggle = async () => { view.el.querySelector('.tb-fmt').click(); thousands().click(); await vi.advanceTimersByTimeAsync(1); };
    await toggle();
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 0, group: false });
    await toggle();
    expect(wb.getCell(id, 0, 0).s).toEqual({ fmt: 'currency', cur: 'EUR', dec: 0 });
  });
});
