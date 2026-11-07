// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editorView } from '../src/views/editor.js';
import { Doc } from '../src/lib/doc.js';

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

it('uses worksheet headings instead of a stale device override and persists the menu toggle with Undo',async()=>{
 const doc=new Doc({name:'Headings'}),wb=doc.wb,id=wb.activeSheetId;
 wb.setHeaders(id,false);wb.clearHistory();localStorage.setItem('spreadsheet:view',JSON.stringify({headers:true}));
 view=editorView({doc,goHome:vi.fn(),openPath:vi.fn(),newDoc:vi.fn(),templateDoc:vi.fn(),importFile:vi.fn()});document.body.append(view.el);await vi.advanceTimersByTimeAsync(1);
 expect(view.el.querySelector('.grid').classList.contains('no-headers')).toBe(true);
 view.el.querySelector('[data-menu="view"]').click();
 const item=[...document.querySelectorAll('.menu-item')].find(b=>b.querySelector('.menu-label')?.textContent==='Row and column headers');item.click();await vi.advanceTimersByTimeAsync(10);
 expect(wb.sheet(id).headers).toBe(true);expect(wb.undoLabel()).toBe('Row and column headers');expect(view.el.querySelector('.grid').classList.contains('no-headers')).toBe(false);
 wb.undo();await vi.advanceTimersByTimeAsync(10);expect(view.el.querySelector('.grid').classList.contains('no-headers')).toBe(true);
 localStorage.removeItem('spreadsheet:view');
});
