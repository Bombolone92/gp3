// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { cellsToHtml } from '../src/core/clipboard.js';
let html = '', text = '';
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
  vi.stubGlobal('navigator',{onLine:true,clipboard:{read:async()=>[{types:['text/html','text/plain'],getType:async type=>({text:async()=>type==='text/html'?html:text})}]}});
  document.body.replaceChildren();
});
afterEach(() => {view?.destroy();view=null;vi.clearAllTimers();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});


it.each(['internal', 'private', 'html'].flatMap(kind => ['all', 'Transposed', 'Skip blanks', 'Values only', 'Formulas only (keep formatting)'].map(mode => [kind, mode])))('replaces or keeps inherited destination formats: %s / %s', async (kind, mode) => {
  const doc = new Doc({ name: 'Paste formats', path: 'Spreadsheets/Paste formats.xlsx' }), wb = doc.wb, id = wb.activeSheetId;
  wb.sheet(id).colStyles.set(3, { bold: true, bg: '#ffdd99', fmt: 'currency', cur: 'USD', dec: 2 });
  wb.sheet(id).rowStyles.set(4, { underline: true, wrap: true });
  wb.setCells(id, [{ r: 0, c: 0, cell: { v: 2, s: { italic: true } } }, { r: 4, c: 3, cell: { v: 99 } }]);
  const copied = wb.copyRange(id, { r1: 0, c1: 0, r2: 1, c2: 0 });
  html = cellsToHtml([['2'], ['']], copied); text = '2\n';
  if (kind === 'html') html = html.replace(/ data-spreadsheet-[\w-]+="[^"]*"/g, '');
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(1);
  const viewport = view.el.querySelector('.grid-viewport'); viewport.focus();
  if (kind === 'internal') {
    view.goTo('Sheet1!A1:A2');
    const event = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { setData() {} } }); viewport.dispatchEvent(event);
    html = ''; text = '';
  }
  view.goTo('Sheet1!D5'); wb.clearHistory(); const before = wb.toJSON();
  if (mode === 'all') {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: type => type === 'text/html' ? html : type === 'text/plain' ? text : '', files: [] } });
    viewport.dispatchEvent(event);
  } else {
    const item = label => [...document.querySelectorAll('.menu-item')].find(b => b.querySelector('.menu-label')?.textContent === label);
    view.el.querySelector('[data-menu="edit"]').click(); item('Paste special').click(); item(mode).click();
  }
  await vi.advanceTimersByTimeAsync(10);
  expect(wb.getValue(id, 4, 3)).toBe(2);
  const kept = mode === 'Values only' || mode === 'Formulas only (keep formatting)';
  const style = wb.styleAt(id, 4, 3);
  expect(!!style.italic).toBe(!kept);
  expect(!!style.bold).toBe(kept); expect(!!style.bg).toBe(kept);
  expect(!!style.fmt).toBe(kept); expect(!!style.underline).toBe(kept);
  const blankStyle = wb.styleAt(id, mode === 'Transposed' ? 4 : 5, mode === 'Transposed' ? 4 : 3);
  if (mode === 'Skip blanks' || kept) expect(blankStyle).toMatchObject({ bold: true, bg: '#ffdd99', fmt: 'currency' });
  else for (const key of ['bold', 'bg', 'fmt', 'underline', 'wrap']) expect(blankStyle?.[key], key).toBeFalsy();
  expect(wb.undoLabels()).toHaveLength(1); wb.undo(); view.goTo('Sheet1!D5'); expect(wb.toJSON()).toEqual(before);
});
