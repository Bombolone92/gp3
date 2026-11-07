// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { errorCheckAt, setErrorCheckingOptions, errorCheckingOptions, ERROR_RULES } from '../src/core/error-checking.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeMenu } from '../src/ui/menu.js';
import { closeAllModals } from '../src/ui/modal.js';

const defaults = () => setErrorCheckingOptions({ enabled: true, ...Object.fromEntries(ERROR_RULES.map(([k, , on]) => [k, on])) });
afterEach(defaults);

describe('background error checking rules', () => {
  it('flags formula errors, numbers stored as text, two-digit text years and unlocked formulas', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, '=1/0');
    wb.setInput(id, 1, 0, "'42");
    wb.setInput(id, 2, 0, "'1/2/23");
    wb.setInput(id, 3, 0, '=2+2'); wb.applyStyle(id, { r1: 3, c1: 0, r2: 3, c2: 0 }, { locked: false });
    wb.setInput(id, 4, 0, 'Plain text');
    const key = (r, c) => errorCheckAt(wb, id, r, c)?.key ?? null;
    expect([key(0, 0), key(1, 0), key(2, 0), key(3, 0), key(4, 0)]).toEqual(['evalError', 'numberStoredAsText', 'twoDigitTextYear', 'unlockedFormula', null]);
    expect(errorCheckAt(wb, id, 0, 0).title).toBe('Divide by Zero Error');
  });

  it('flags a formula unlike its neighbours and a total that leaves out adjacent numbers', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    ['1', '2', '3', '4'].forEach((v, r) => { wb.setInput(id, r, 0, v); wb.setInput(id, r, 1, v); });
    wb.setInput(id, 0, 2, '=A1+B1'); wb.setInput(id, 1, 2, '=A2*B2'); wb.setInput(id, 2, 2, '=A3+B3');
    expect(errorCheckAt(wb, id, 1, 2)?.key).toBe('formula');
    expect(errorCheckAt(wb, id, 0, 2)).toBeNull();
    wb.setInput(id, 4, 0, '=SUM(A1:A3)');
    expect(errorCheckAt(wb, id, 4, 0)?.key).toBe('formulaRange');
    wb.setInput(id, 4, 1, '=SUM(B1:B4)');
    expect(errorCheckAt(wb, id, 4, 1)).toBeNull();
  });

  it('passes over ignored cells and rules turned off, and undoes Ignore Error', () => {
    const wb = new Workbook();
    const id = wb.activeSheetId;
    wb.setInput(id, 0, 0, "'7");
    wb.ignoreErrors(id, [{ r1: 0, c1: 0, r2: 0, c2: 0 }], 'numberStoredAsText');
    expect(errorCheckAt(wb, id, 0, 0)).toBeNull();
    wb.undo();
    expect(errorCheckAt(wb, id, 0, 0)?.key).toBe('numberStoredAsText');
    setErrorCheckingOptions({ ...errorCheckingOptions(), numberStoredAsText: false });
    expect(errorCheckAt(wb, id, 0, 0)).toBeNull();
    setErrorCheckingOptions({ ...errorCheckingOptions(), numberStoredAsText: true, enabled: false });
    expect(errorCheckAt(wb, id, 0, 0)).toBeNull();
  });
});

describe('the smart tag in the editor', () => {
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

  it('marks the cell, and converts a number stored as text from the tag, as one undo step', async () => {
    const doc = new Doc({ name: 'Errors', path: 'Spreadsheets/Errors.xlsx' });
    const { wb } = doc;
    const id = wb.activeSheetId;
    wb.setInput(id, 1, 1, "'1,250");
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    view.goTo('B2');
    await vi.advanceTimersByTimeAsync(20);
    expect(view.el.querySelector('#gc-1-1')?.classList.contains('err-flag')).toBe(true);
    const tag = view.el.querySelector('.error-smarttag');
    expect(tag.hidden).toBe(false);
    expect(tag.getAttribute('aria-label')).toBe('Error: Number Stored as Text');
    tag.click();
    await vi.advanceTimersByTimeAsync(5);
    [...document.querySelectorAll('.menu-item')].find((n) => n.querySelector('.menu-label')?.textContent === 'Convert to Number').click();
    await vi.advanceTimersByTimeAsync(20);
    expect(wb.getValue(id, 1, 1)).toBe(1250);
    expect(wb.undoLabels()).toEqual(['Convert to number']);
    expect(tag.hidden).toBe(true);
  });
});
