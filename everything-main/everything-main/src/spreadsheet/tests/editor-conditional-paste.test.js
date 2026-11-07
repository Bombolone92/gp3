// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

let view, html = '', text = '';
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

function transfer(view, kind, payload = {}) {
  const viewport = view.el.querySelector('.grid-viewport'); viewport.focus();
  const e = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { setData: (type, data) => { payload[type] = data; }, getData: type => payload[type] || '', files: [] } });
  viewport.dispatchEvent(e); return payload;
}
it.each(['all', 'Formatting only', 'Transposed', 'Values only', 'Formulas only'])('ordinary editor copy carries live rules through %s', async mode => {
  const doc = new Doc({ name: 'Copy', path: 'Spreadsheets/Copy.xlsx' }), wb = doc.wb, id = wb.activeSheetId;
  wb.setInput(id, 0, 0, '4'); wb.setInput(id, 1, 0, '2');
  wb.addRule(id, { type: 'formula', range: { r1: 0, c1: 0, r2: 1, c2: 0 }, value: 'A1>3', style: { bg: '#ffaaaa' } });
  wb.addValidation(id, {type:'formula', source:'A1>0', range:{r1:0,c1:0,r2:1,c2:0}, prompt:'Positive'});
  view = editorView({ doc, goHome: vi.fn(), openPath: vi.fn(), newDoc: vi.fn(), templateDoc: vi.fn(), importFile: vi.fn() });
  document.body.append(view.el); await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1:A2');
  const payload = transfer(view, 'copy'); html = payload['text/html']; text = payload['text/plain'];
  expect(html).toContain('data-spreadsheet-rules');
  expect(html).toContain('data-spreadsheet-validations');
  view.goTo('Sheet1!C4'); wb.clearHistory();
  if (mode === 'all') transfer(view, 'paste', payload);
  else {
    const item = label => [...document.querySelectorAll('.menu-item')].find(b => b.querySelector('.menu-label')?.textContent === label);
    view.el.querySelector('[data-menu="edit"]').click(); item('Paste special').click(); item(mode === 'Formulas only' ? 'Formulas only (keep formatting)' : mode).click();
  }
  await vi.advanceTimersByTimeAsync(10);
  const validation = wb.validationAt(id,3,2);
  if (['all','Transposed'].includes(mode)) expect(validation).toMatchObject({source:'C4>0',prompt:'Positive'});
  else expect(validation).toBeNull();
  const live = !['Values only', 'Formulas only'].includes(mode);
  expect(wb.activeSheet.rules).toHaveLength(live ? 2 : 1);
  if (live) {
    expect(wb.activeSheet.rules[0].value).toBe('C4>3');
    wb.setInput(id, 3, 2, '9'); expect(wb.conditionalStyle(id, 3, 2, 9)).toEqual({ bg: '#ffaaaa' }); wb.undo();
  }
  wb.undo(); expect(wb.activeSheet.validations).toHaveLength(1); expect(wb.activeSheet.rules).toHaveLength(1); expect(wb.getValue(id, 3, 2)).toBeNull();
});
it.each([false,true])('editor cut carries partial rules and supports one-step undo (hidden=%s)',async hidden=>{
  const doc=new Doc({name:'Cut',path:'Spreadsheets/Cut.xlsx'}),wb=doc.wb,id=wb.activeSheetId;
  [1,2,3,4,5].forEach((v,r)=>wb.setInput(id,r,0,String(v)));
  wb.addRule(id,{type:'formula',range:{r1:0,c1:0,r2:4,c2:0},value:'A1>2',style:{bg:'#ffaaaa'}});
  if(hidden)wb.activeSheet.hiddenRows.add(2);
  view=editorView({doc,goHome:vi.fn(),openPath:vi.fn(),newDoc:vi.fn(),templateDoc:vi.fn(),importFile:vi.fn()});
  document.body.append(view.el);await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A2:A4');const before=wb.toJSON(),payload=transfer(view,'cut');
  view.goTo('Sheet1!C6');wb.clearHistory();transfer(view,'paste',payload);await vi.advanceTimersByTimeAsync(10);
  expect(wb.getValue(id,5,2)).toBe(2);expect(wb.getValue(id,6,2)).toBe(hidden?4:3);
  expect(wb.conditionalStyle(id,6,2,wb.getValue(id,6,2))).toEqual({bg:'#ffaaaa'});
  expect(wb.conditionalStyle(id,1,0,8)).toBeNull();
  if(hidden){expect(wb.getValue(id,2,0)).toBe(3);expect(wb.conditionalStyle(id,2,0,3)).toEqual({bg:'#ffaaaa'});}
  expect(wb.undoLabels()).toEqual(['Move cells']);wb.undo();
  const restored=wb.toJSON();for(const book of [before,restored])for(const sheet of book.sheets)delete sheet.viewSelection;
  expect(restored).toEqual(before);
});
it('cross-tab validation snapshots preserve rules and disable external formula access',async()=>{
 const doc=new Doc({name:'Source'}),wb=doc.wb,id=wb.activeSheetId;
 wb.setInput(id,0,0,'1');wb.addValidation(id,{type:'formula',source:'IMPORTDATA("https://example.test/check")=A1',range:{r1:0,c1:0,r2:0,c2:0}});
 const mount=async doc=>{view=editorView({doc,goHome:vi.fn(),openPath:vi.fn(),newDoc:vi.fn(),templateDoc:vi.fn(),importFile:vi.fn()});document.body.append(view.el);await vi.advanceTimersByTimeAsync(1)};
 await mount(doc);view.goTo('Sheet1!A1');const payload=transfer(view,'copy');view.destroy();view=null;document.body.replaceChildren();
 const other=new Doc({name:'Target'});await mount(other);view.goTo('Sheet1!C3');transfer(view,'paste',payload);await vi.advanceTimersByTimeAsync(10);
 expect(other.wb.validationAt(other.wb.activeSheetId,2,2).source).toBe('IMPORTDATA("https://example.test/check")=C3');
 expect(other.wb.externalAllowed).toBe(false);
});
