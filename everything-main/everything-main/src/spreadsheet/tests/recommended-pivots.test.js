// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { recommendPivots } from '../src/core/pivot-recommend.js';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

const ROWS = [['Region', 'Product', 'Units', 'Amount'], ['North', 'Pens', 3, 30], ['South', 'Pens', 5, 50], ['North', 'Paper', 2, 12], ['East', 'Paper', 4, 24], ['South', 'Ink', 1, 9]];
const fill = (wb, id) => ROWS.forEach((row, r) => row.forEach((v, c) => wb.setInput(id, r, c, String(v))));
const range = { r1: 0, c1: 0, r2: ROWS.length - 1, c2: 3 };

it('recommends totals of the number columns by each category, and counts', () => {
  const wb = new Workbook();
  const id = wb.activeSheetId;
  fill(wb, id);
  const picks = recommendPivots(wb, id, range);
  expect(picks.map((p) => p.title)).toEqual([
    'Sum of Units by Region', 'Sum of Units by Region and Product', 'Sum of Amount by Region', 'Count of Region by Region',
    'Sum of Units by Product', 'Sum of Amount by Product', 'Count of Product by Product',
  ]);
  expect(picks[2].preview).toEqual([['East', 24], ['North', 42], ['South', 59]]);
  expect(picks[3].preview).toEqual([['East', 1], ['North', 2], ['South', 2]]);
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
  afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('inserts the chosen recommendation on a new sheet as one undo step', async () => {
    const doc = new Doc({ name: 'Rec', path: 'Spreadsheets/Rec.xlsx' });
    const { wb } = doc;
    fill(wb, wb.activeSheetId);
    wb.clearHistory();
    view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
    document.querySelector('#app').append(view.el);
    await vi.advanceTimersByTimeAsync(5);
    view.goTo('A1');
    [...view.el.querySelectorAll('.ribbon-tab')].find((t) => t.textContent === 'Insert').click();
    await vi.advanceTimersByTimeAsync(5);
    view.el.querySelector('[aria-label="Recommended PivotTables"]').click();
    await vi.advanceTimersByTimeAsync(5);
    const options = [...document.querySelectorAll('.rec-pivot-item')];
    expect(options.length).toBeGreaterThan(3);
    options[2].click();
    expect(document.querySelector('.rec-pivot-title').textContent).toBe('Sum of Amount by Region');
    [...document.querySelectorAll('.modal-panel button')].find((b) => b.textContent === 'OK').click();
    await vi.advanceTimersByTimeAsync(20);
    const pivot = wb.sheets.find((s) => s.name.startsWith('Pivot of'));
    expect(pivot).toBeTruthy();
    const shown = [];
    for (let r = 0; r < 8; r++) shown.push([wb.getValue(pivot.id, r, 0), wb.getValue(pivot.id, r, 1)]);
    expect(shown).toEqual(expect.arrayContaining([['North', 42], ['South', 59], ['East', 24]]));
    expect(wb.undoLabels()).toEqual(['Insert pivot table']);
  });
});
