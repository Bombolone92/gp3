// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { closeAllModals } from '../src/ui/modal.js';

let view;
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: text => ({ width: text.length * 7 }), font: '' });
  localStorage.clear(); document.body.replaceChildren();
});
afterEach(() => { closeAllModals(); view?.destroy(); view = null; vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

async function open(setup) {
  const doc = new Doc({ name: 'Forecast' }); const wb = doc.wb; const id = wb.activeSheetId;
  setup(wb, id);
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(1);
  [...view.el.querySelectorAll('.ribbon [role="tab"]')].find(t => t.textContent === 'Data').click(); await vi.advanceTimersByTimeAsync(1);
  return { wb, id };
}
const ribbon = (label) => [...view.el.querySelectorAll('.ribbon-panels button')].find(b => b.getAttribute('aria-label') === label);

it('creates a forecast worksheet from Data ▸ Forecast Sheet', async () => {
  const { wb } = await open((wb, id) => [12, 15, 14, 18, 16, 19, 21, 20, 23, 25, 24, 27].forEach((v, i) => { wb.setInput(id, i, 0, String(i + 1)); wb.setInput(id, i, 1, String(v)); }));
  view.goTo('A1:B12'); await vi.advanceTimersByTimeAsync(1);
  ribbon('Forecast Sheet').click(); await vi.advanceTimersByTimeAsync(1);
  const form = document.querySelector('.fs-dialog');
  expect(form.querySelector('.fs-preview svg')).not.toBeNull();
  form.requestSubmit(); await vi.advanceTimersByTimeAsync(1);
  const sheet = wb.sheets.find(s => s.charts.length);
  expect(wb.getValue(sheet.id, 13, 0)).toBe(13);
  expect(wb.getValue(sheet.id, 13, 2)).toBeCloseTo(27.597215758782, 9); // FORECAST.ETS(13, ...)
});

it('opens Scenario Manager, Advanced Filter, and shows and hides detail', async () => {
  const { wb, id } = await open((wb, id) => { wb.setInput(id, 0, 0, 'Item'); wb.setInput(id, 1, 0, 'a'); wb.setInput(id, 2, 0, 'b'); wb.groupLines(id, 'row', 1, 2); });
  ribbon('What-If Analysis').click(); await vi.advanceTimersByTimeAsync(1);
  [...document.querySelectorAll('.menu-item')].find(n => n.textContent.includes('Scenario Manager…')).click(); await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('.sm-manager')).not.toBeNull();
  closeAllModals(); await vi.advanceTimersByTimeAsync(300);
  ribbon('Advanced filter').click(); await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelector('.af-dialog input[type="text"]').value).toBe('Sheet1!$A$1:$A$3');
  closeAllModals(); await vi.advanceTimersByTimeAsync(300);
  view.goTo('A2'); await vi.advanceTimersByTimeAsync(1);
  ribbon('Hide Detail').click(); await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(id).groups.rows[0].collapsed).toBe(true);
  view.goTo('A4'); await vi.advanceTimersByTimeAsync(1);
  ribbon('Show Detail').click(); await vi.advanceTimersByTimeAsync(1);
  expect(wb.sheet(id).groups.rows[0].collapsed).toBe(false);
  expect(ribbon('Clear filter')).toBeTruthy();
  expect(ribbon('Reapply')).toBeTruthy();
});
