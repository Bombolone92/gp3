// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { invalidCells } from '../src/core/validation-circles.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';

// Data ▸ Data Validation ▸ Circle Invalid Data circles the cells whose values break their rule.
const rule = { range: { r1: 0, c1: 0, r2: 9, c2: 0 }, type: 'number', min: 0, max: 10 };

it('finds the cells whose current value breaks their rule, leaving blanks and valid values out', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  ['5', '50', '', '-1', 'text'].forEach((v, r) => { if (v) wb.setInput(id, r, 0, v); });
  wb.setInput(id, 0, 1, '99'); // no rule here
  wb.addValidation(id, rule);
  expect(invalidCells(wb, id).cells).toEqual([{ r: 1, c: 0 }, { r: 3, c: 0 }, { r: 4, c: 0 }]);
  expect(invalidCells(wb, id, 2)).toEqual({ cells: [{ r: 1, c: 0 }, { r: 3, c: 0 }], more: true });
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
  afterEach(() => { closeMenu(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('circles invalid data from the Data Validation arrow, drops a circle once its cell is fixed, and clears them', async () => {
    const doc = new Doc({ name: 'Circles', path: 'Spreadsheets/Circles.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '50'); wb.setInput(id, 1, 0, '3'); wb.setInput(id, 2, 0, '-4');
    wb.addValidation(id, rule);
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    const choose = async (label) => {
      [...view.el.querySelectorAll('.ribbon-tab')].find((t) => t.textContent === 'Data').click();
      await vi.advanceTimersByTimeAsync(5);
      view.el.querySelector('[aria-label="Data Validation options"]').click();
      await vi.advanceTimersByTimeAsync(5);
      [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === label).click();
      await vi.advanceTimersByTimeAsync(20);
    };
    await choose('Circle Invalid Data');
    expect(view.el.querySelectorAll('.invalid-circle')).toHaveLength(2);
    wb.setInput(id, 0, 0, '7');
    await vi.advanceTimersByTimeAsync(20);
    expect(view.el.querySelectorAll('.invalid-circle')).toHaveLength(1);
    await choose('Clear Validation Circles');
    expect(view.el.querySelectorAll('.invalid-circle')).toHaveLength(0);
  });
});
