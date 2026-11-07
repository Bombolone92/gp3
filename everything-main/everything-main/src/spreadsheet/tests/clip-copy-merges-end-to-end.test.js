// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

// The copy path handed cellsToHtml no merges and no line formats, so the flavour other apps read had one
// plain <td> per cell of a merged block — a report header pasted into Word or Excel lost its layout — and a
// cell whose format comes from its whole column arrived unformatted. The copy now names the merges and the
// lines it took; the column and row formats need no grid of their own, because copyRange already folds each
// line's format into the copied cell's own style.
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
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: (t) => ({ width: t.length * 7 }), font: '' });
  document.body.innerHTML = '<div id="app"></div>';
});
afterEach(() => { view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function mount(prep) {
  const doc = new Doc({ name: 'Copy', path: 'Spreadsheets/Copy.xlsx' });
  const { wb } = doc;
  const id = wb.activeSheetId;
  prep(wb, id);
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.querySelector('#app').append(view.el);
  await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport');
  viewport.focus();
  const copy = async (a) => {
    let copied = {};
    view.goTo(`Sheet1!${a}`);
    await vi.advanceTimersByTimeAsync(1);
    const e = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { getData: () => '', setData: (t, v) => { copied[t] = v; }, files: [] }, });
    viewport.dispatchEvent(e);
    return copied['text/html'];
  };
  return { wb, id, copy };
}

/** The <td>s of the copied table, in order, as the markup gives them. */
const tds = (html) => html.slice(html.indexOf('<tbody>')).match(/<td[^>]*>.*?<\/td>/g) || [];
const rowsOf = (html) => html.slice(html.indexOf('<tbody>')).split('<tr>').slice(1);

it('gives a copied merged block one cell with its spans, and none for the cells it covers', async () => {
  const { copy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'Report title');
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 1, c2: 2 }); // three columns wide, two rows deep
    wb.setInput(id, 2, 0, 'a'); wb.setInput(id, 2, 1, 'b'); wb.setInput(id, 2, 2, 'c');
  });
  const html = await copy('A1:C3');
  const cells = tds(html);
  // One <td> for the block, then the three cells of the row below it: the five covered cells are gone.
  expect(cells).toHaveLength(4);
  expect(cells[0]).toMatch(/<td[^>]*rowspan="2"[^>]*colspan="3"[^>]*>Report title<\/td>/);
  expect(cells.slice(1).map((td) => td.replace(/<[^>]+>/g, ''))).toEqual(['a', 'b', 'c']);
  // The second row of the block carries no cell of its own at all.
  expect(rowsOf(html).map((row) => (row.match(/<td/g) || []).length)).toEqual([1, 0, 3]);
});

it('spans the lines the copy took, not the ones the merge covers, when a column inside it is hidden', async () => {
  const { copy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, 'wide');
    wb.mergeCells(id, { r1: 0, c1: 0, r2: 0, c2: 3 });
    wb.setHidden(id, 'col', [2], true); // C is hidden, so the copy takes A, B and D
  });
  // A copy is what is on screen: three of the merge's four columns travelled, so the span is three.
  const html = await copy('A1:D1');
  expect(tds(html)).toHaveLength(1);
  expect(tds(html)[0]).toMatch(/colspan="3"/);
});

it('leaves an ordinary copy with one cell each and no spans', async () => {
  const { copy } = await mount((wb, id) => {
    wb.setInput(id, 0, 0, '1'); wb.setInput(id, 0, 1, '2');
  });
  const html = await copy('A1:B1');
  expect(tds(html)).toHaveLength(2);
  expect(html).not.toMatch(/colspan|rowspan/);
});

it('carries the format a whole-column format gives a cell that has none of its own', async () => {
  const { wb, id, copy } = await mount((wb, id) => {
    wb.setInput(id, 2, 3, '1234.5');
    wb.applyStyle(id, { r1: 0, c1: 3, r2: wb.sheet(id).rows - 1, c2: 3 }, { fmt: 'currency', dec: 2, bold: true });
  });
  // The format lives on the column, not on the cell: nothing is stored in the cell's own style.
  expect(wb.sheet(id).colStyles.get(3)).toMatchObject({ fmt: 'currency', dec: 2, bold: true });
  const html = await copy('D3');
  const td = tds(html)[0];
  expect(td).toContain('$1,234.50');
  expect(td).toMatch(/mso-number-format/); // the number format travels for Excel
  expect(td).toMatch(/font-weight:\s*bold/); // and so does the look
});
