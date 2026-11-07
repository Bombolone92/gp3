// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { quickTotalEntries } from '../src/core/quick-totals.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

const ROWS = [['Item', 'Q1', 'Q2'], ['Pens', '3', '5'], ['Ink', '4', '6']];
const fill = (wb, id) => ROWS.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, v)));
const block = { r1: 0, c1: 0, r2: 2, c2: 2 };

describe('Quick Analysis totals', () => {
  it('totals each column in the row below, leaving the header row out', () => {
    const wb = new Workbook(); const id = wb.activeSheetId; fill(wb, id);
    expect(quickTotalEntries(wb, id, block, 'sum', 'rows').map((e) => [e.r, e.c, e.input])).toEqual([[3, 0, '=SUM(A2:A3)'], [3, 1, '=SUM(B2:B3)'], [3, 2, '=SUM(C2:C3)']]);
    expect(quickTotalEntries(wb, id, block, 'percent', 'rows')[1]).toMatchObject({ input: '=SUM(B2:B3)/SUM($A$2:$C$3)', style: { fmt: 'percent' } });
  });

  it('totals each row in the column to the right, naming it in the header row', () => {
    const wb = new Workbook(); const id = wb.activeSheetId; fill(wb, id);
    expect(quickTotalEntries(wb, id, block, 'average', 'columns').map((e) => [e.r, e.c, e.input])).toEqual([[1, 3, '=AVERAGE(A2:C2)'], [2, 3, '=AVERAGE(A3:C3)'], [0, 3, 'Average']]);
    expect(quickTotalEntries(wb, id, block, 'running', 'columns').map((e) => e.input).slice(0, 2)).toEqual(['=SUM($A$2:$C2)', '=SUM($A$2:$C3)']);
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
    document.body.innerHTML = '<div id="app"></div>';
  });
  afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('shows the button for a block of data, opens with Ctrl+Q, and adds totals below as one undo step', async () => {
    const doc = new Doc({ name: 'QA', path: 'Spreadsheets/QA.xlsx' });
    const { wb } = doc; const id = wb.activeSheetId; fill(wb, id); wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    const button = view.el.querySelector('.quick-analysis-btn');
    view.goTo('E5'); await vi.advanceTimersByTimeAsync(20);
    expect(button.hidden).toBe(true);
    view.goTo('A1:C3'); await vi.advanceTimersByTimeAsync(20);
    expect(button.hidden).toBe(false);
    const vp = view.el.querySelector('.grid-viewport'); vp.focus();
    vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(5);
    const panel = document.querySelector('.quick-analysis');
    expect([...panel.querySelectorAll('.qa-tab')].map((t) => t.textContent)).toEqual(['Formatting', 'Charts', 'Totals', 'Tables', 'Sparklines']);
    [...panel.querySelectorAll('.qa-tab')].find((t) => t.textContent === 'Totals').click();
    document.querySelector('.qa-tile[aria-label="Sum, totals in the row below"]').click();
    await vi.advanceTimersByTimeAsync(20);
    expect([wb.getValue(id, 3, 1), wb.getValue(id, 3, 2)]).toEqual([7, 11]);
    expect(wb.styleAt(id, 3, 1)).toMatchObject({ bold: true });
    expect(wb.undoLabels()).toEqual(['Quick totals']);
    expect(document.querySelector('.quick-analysis')).toBeNull();
  });
});
