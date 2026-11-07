// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';
import { Workbook } from '../src/core/workbook.js';
import { cellsToHtml, parseHtmlClipboard } from '../src/core/clipboard.js';

const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><style>
td {white-space:normal;vertical-align:bottom} .filled {mso-number-format:'0;0;0;@*.'}
.literal {mso-number-format:'\\@'} .prefix {mso-number-format:'0;0;0;"prefix "@'}
</style><table><tr><td class=filled>###</td><td x:num="1.234">1.23</td></tr>
<tr><td class=literal>=1+1</td><td class=prefix>prefix word</td></tr></table></html>`;
const text = '"long\nlabel"\t1.23\n=1+1\tprefix word';
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

it.each(['all','Values only','Transposed','Formatting only'])('preserves spreadsheet representations through %s and undo', async mode => {
  const doc=new Doc({name:'Representations',path:'Spreadsheets/Representations.xlsx'}), wb=doc.wb,id=wb.activeSheetId;
  wb.setCells(id,[{r:0,c:0,cell:{v:'old',s:{italic:true,valign:'top'}}}]);wb.clearHistory();
  view=editorView({doc,goHome:vi.fn(),openPath:vi.fn(),newDoc:vi.fn(),templateDoc:vi.fn(),importFile:vi.fn()});
  document.body.append(view.el);await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!A1');const viewport=view.el.querySelector('.grid-viewport');viewport.focus();
  if(mode==='all') {
    const e=new Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(e,'clipboardData',{value:{getData:type=>type==='text/html'?html:type==='text/plain'?text:'',files:[]}});
    viewport.dispatchEvent(e);
  } else {
    const item=label=>[...document.querySelectorAll('.menu-item')].find(b=>b.querySelector('.menu-label')?.textContent===label);
    view.el.querySelector('[data-menu="edit"]').click();item('Paste special').click();item(mode).click();
  }
  await vi.advanceTimersByTimeAsync(10);
  if(mode==='Formatting only') {
    expect(wb.getValue(id,0,0)).toBe('old');expect(wb.getValue(id,0,1)).toBeNull();
    expect(wb.styleAt(id,0,0)).toMatchObject({code:'0;0;0;@*.',wrap:true,valign:'bottom'});
  } else {
    const expected=mode==='Transposed'?[['long\nlabel','=1+1'],[1.234,'word']]:[['long\nlabel',1.234],['=1+1','word']];
    expected.forEach((row,r)=>row.forEach((value,c)=>{expect(wb.getValue(id,r,c)).toBe(value);expect(wb.getCell(id,r,c).f).toBeNull();}));
    if(mode==='Values only') expect(wb.styleAt(id,0,0)).toEqual({italic:true,wrap:true,valign:'top'});
    else expect(wb.styleAt(id,0,0)).toMatchObject({code:'0;0;0;@*.',wrap:true,valign:'bottom'});
  }
  wb.undo();expect(wb.getValue(id,0,0)).toBe('old');expect(wb.getValue(id,0,1)).toBeNull();
  expect(wb.styleAt(id,0,0)).toEqual({italic:true,valign:'top'});
});

it('pastes cached external links through the editor and restores the previous graph on undo', async () => {
  const links = value => ({version:1,books:[{target:'https://example.com/source.xlsx',sheets:[{name:'Data',cells:{'0,0':value}}]}]});
  const wb = new Workbook({externalWorkbooks:links(99)}), id = wb.activeSheetId;
  const doc = new Doc({wb,name:'Links',path:'Spreadsheets/Links.xlsx'});
  view=editorView({doc,goHome:vi.fn(),openPath:vi.fn(),newDoc:vi.fn(),templateDoc:vi.fn(),importFile:vi.fn()});
  document.body.append(view.el);await vi.advanceTimersByTimeAsync(1);
  view.goTo('Sheet1!B2');const viewport=view.el.querySelector('.grid-viewport');viewport.focus();
  const copied = cellsToHtml([['3']],[[{f:'[1]Data!$A$1'}]],null,[[3]],{r:0,c:0},{externalWorkbooks:links(3)});
  const event = new Event('paste',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{getData:type=>type==='text/html'?copied:type==='text/plain'?'3':'',files:[]}});
  viewport.dispatchEvent(event);await vi.advanceTimersByTimeAsync(10);
  expect(wb.getValue(id,1,1)).toBe(3);expect(wb.externalWorkbooks.books).toHaveLength(2);
  wb.undo();expect(wb.externalWorkbooks.books).toHaveLength(1);expect(wb.getValue(id,1,1)).toBeNull();
  wb.redo();expect(wb.getValue(id,1,1)).toBe(3);
});

it('resolves source-relative links during a native copy event from a known drive path', async () => {
  const externalWorkbooks = {version:1,books:[{target:'../Data/Source%20A.xlsx',sheets:[{name:'Data',cells:{'0,0':3}}]}]};
  const wb = new Workbook({externalWorkbooks,sheets:[{name:'Report',cells:{'0,0':{f:'[1]Data!A1'}}}]});
  const doc = new Doc({wb,name:'Report',path:'/drive/Reports/Report #1.xlsx'});
  view=editorView({doc,goHome:vi.fn(),openPath:vi.fn(),newDoc:vi.fn(),templateDoc:vi.fn(),importFile:vi.fn()});
  document.body.append(view.el);await vi.advanceTimersByTimeAsync(1);
  view.goTo('Report!A1');const viewport=view.el.querySelector('.grid-viewport');viewport.focus();
  const payload = {}, event = new Event('copy',{bubbles:true,cancelable:true});
  Object.defineProperty(event,'clipboardData',{value:{setData:(type,value)=>{payload[type]=value;}}});
  viewport.dispatchEvent(event);
  const parsed = parseHtmlClipboard(payload['text/html'],payload['text/plain']);
  expect(parsed.externalWorkbooks.books[0].target).toBe('/drive/Data/Source%20A.xlsx');
  expect(wb.externalWorkbooks.books[0].target).toBe('../Data/Source%20A.xlsx');
});
