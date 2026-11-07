// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import * as notifications from '../src/ui/toast.js';

let view;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({matches:true,addEventListener(){},removeEventListener(){}}));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn,0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Element.prototype.scrollIntoView = () => {}; Element.prototype.scrollTo = () => {};
  Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get:()=>800});
  Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get:()=>400});
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({measureText:t=>({width:t.length*7}),font:''});

  document.body.replaceChildren();
});
afterEach(() => {view?.destroy();view=null;vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});

it('retains a native report through editor copy/paste, refuses a partial delete and undoes once', async () => {
  const doc = new Doc({ name: 'Reports', path: 'Spreadsheets/Reports.xlsx' }), wb = doc.wb, id = wb.activeSheetId;
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 'Total' } }, { r: 1, c: 1, cell: { v: 19 } }]);
  wb.nativePivots = { version: 1, caches: [{ key: 'source', scope: 'main', xml: `<pivotCacheDefinition xmlns="${ns}"><cacheSource type="worksheet"><worksheetSource sheet="Sheet1" ref="H1:H2"/></cacheSource></pivotCacheDefinition>`, records: '' }],
    tables: [{ name: 'Report', owner: id, cache: 'source', ref: 'A1:B2', xml: `<pivotTableDefinition xmlns="${ns}" name="Report"><location ref="A1:B2"/></pivotTableDefinition>` }], dxfs: [], styles: [], formats: {}, connections: '' };
  const before = wb.nativePivots;
  const table = wb.addTable(id, { r1: 4, c1: 0, r2: 5, c2: 2 });
  wb.clearHistory();
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport'), payload = {};
  const dispatch = type => {
    viewport.focus(); const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: t => payload[t] || '', setData: (t, v) => { payload[t] = v; } } });
    viewport.dispatchEvent(event);
  };
  view.goTo('Sheet1!A1:B2'); dispatch('copy'); view.goTo('Sheet1!D5'); dispatch('paste'); await vi.advanceTimersByTimeAsync(10);
  expect(wb.nativePivots.tables.at(-1)).toMatchObject({ name: 'Report_2', ref: 'D5:E6', owner: id });
  expect(wb.getValue(id, 5, 4)).toBe(19); expect(wb.nativePivots.caches).toBe(before.caches);
  expect(wb.tableById(id, table).range).toEqual({ r1: 4, c1: 0, r2: 5, c2: 2 });
  const toast = vi.spyOn(notifications, 'toast');
  view.goTo('Sheet1!E6'); viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
  expect(wb.getValue(id, 5, 4)).toBe(19); expect(toast).toHaveBeenCalledWith('Select the entire pivot table “Report_2” to delete it.', expect.any(Object));
  wb.undo(); expect(wb.nativePivots).toBe(before); expect(wb.getValue(id, 5, 4)).toBeNull(); expect(wb.canUndo()).toBe(false);
});
