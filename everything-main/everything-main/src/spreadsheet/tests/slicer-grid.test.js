// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';
import { buildPrintSheet } from '../src/ui/print.js';
import { slicerClipboard, readSlicerClipboard } from '../src/ui/slicer.js';
import { slicerItems } from '../src/core/slicer.js';
import { normalizeSlicerFormat } from '../src/core/slicer-format.js';
import { openSlicerDialog } from '../src/ui/slicerdialog.js';
let grid;
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ measureText: t => ({ width: t.length * 7 }), font: '' });
  Element.prototype.scrollTo = () => {}; Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('requestAnimationFrame', fn => setTimeout(fn, 0)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { grid?.destroy(); grid = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const paint = { frame: { headerRow: { bold: true } }, items: { selectedItemWithData: { bg: '#ff0000', color: '#ffffff' }, unselectedItemWithData: { bg: '#cccccc' } } };
function make() {
 const wb = new Workbook(), id = wb.activeSheetId;
 ['Category','Alpha','Beta'].forEach((v,r)=>wb.setInput(id,r,0,v)); wb.addTable(id,{r1:0,c1:0,r2:2,c2:0},{name:'Orders'});
 const ch = wb.addChart(id,{type:'slicer',anchor:{r:4,c:0},tableRef:'Orders[Category]',title:'Category',paint,w:300,h:140});
 return { wb, id, ch };
}
it('renders in the actual grid, filters and undoes without replacing the focused button', async () => {
 const {wb,id,ch}=make();grid=createGrid({wb,sheetId:id});document.body.append(grid.el);await flush();
 const box=grid.el.querySelector(`[data-chart="${ch}"]`), buttons=box.querySelectorAll('.slicer-item');
 expect(box.querySelector('svg')).toBeNull();expect(buttons).toHaveLength(2);expect(buttons[0].style.backgroundColor).toBe('rgb(255, 0, 0)');
 buttons[1].focus();buttons[1].click();await flush();expect([...wb.sheet(id).filterHidden]).toEqual([1]);expect(document.activeElement).toBe(buttons[1]);
 wb.undo();await flush();expect([...wb.sheet(id).filterHidden]).toEqual([]);expect(document.activeElement).toBe(buttons[1]);
 wb.updateChart(id,ch,{lockedPosition:true});await flush();expect(box.querySelector('.chart-resize').style.display).toBe('none');
 wb.updateChart(id,ch,{hidden:true});await flush();expect(box.style.display).toBe('none');
});
it('prints the same selection and paint, respects hidden/print flags, and uses read-only controls', () => {
 const {wb,id,ch}=make();wb.setFilterCriteria(id,0,{values:['Beta'],caseSensitive:false});
 const root=buildPrintSheet(wb,id); const items=root.querySelectorAll('.slicer-item');
 expect(items).toHaveLength(2);expect(items[0].getAttribute('aria-pressed')).toBe('false');expect(items[1].getAttribute('aria-pressed')).toBe('true');expect(items[1].disabled).toBe(true);expect(items[1].style.backgroundColor).toBe('rgb(255, 0, 0)');
 wb.updateChart(id,ch,{print:false});expect(buildPrintSheet(wb,id).querySelector('.slicer-control')).toBeNull();
 wb.updateChart(id,ch,{print:true,hidden:true});expect(buildPrintSheet(wb,id).querySelector('.slicer-control')).toBeNull();
});
it('preserves paint and binding through duplication, snapshots and HTML clipboard, with a value fallback', () => {
 const {wb,id,ch}=make();wb.updateChart(id,ch,{hideItemsWithNoData:true});const copy=wb.duplicateChart(id,ch);expect(wb.chartById(id,copy).title).toBe('Category');
 const restored=new Workbook(wb.toJSON()), obj=restored.chartById(id,copy);expect(obj.paint).toEqual(paint);
 const clip=slicerClipboard(document,obj,slicerItems(restored,obj));expect(clip.text).toBe('Alpha\nBeta');
 const pasted=readSlicerClipboard(document,clip.html);expect(pasted.paint).toEqual(paint);expect(pasted.tableRef).toBe('Orders[Category]');expect(pasted.id).toBeUndefined();
 expect(pasted.hideItemsWithNoData).toBe(true);expect(wb.addChart(id,pasted)).toBeTruthy();
});
it('rejects unsafe stored paint, clones valid gradients, and never imports arbitrary CSS', () => {
 expect(()=>normalizeSlicerFormat({items:{selectedItemWithData:{bg:'url(https://example.com/track)'}}})).toThrow(/Invalid stored/);
 const g={type:'linear',degree:90,stops:[{position:0,color:'#112233'},{position:1,color:'#ffffff'}]};
 const format=normalizeSlicerFormat({items:{selectedItemWithData:{gradient:g}}});g.stops[0].color='#000000';expect(format.items.selectedItemWithData.gradient.stops[0].color).toBe('#112233');
 expect(()=>normalizeSlicerFormat({frame:{wholeTable:{gradient:{...g,stops:[{position:0,color:'red'}]}}}})).toThrow();
 expect(readSlicerClipboard(document,'<div data-sheet-slicer="invalid">')).toBeNull();
});
it('edits slicer properties with native row-height units and a single undoable update', () => {
 const {wb,id,ch}=make();const focus=vi.fn();openSlicerDialog({wb,sheetId:()=>id,grid:{focus}},wb.chartById(id,ch));
 document.querySelector('[aria-label="Caption"]').value='Updated';document.querySelector('[aria-label="Columns"]').value='3';document.querySelector('[aria-label="Item height (pixels)"]').value='30.5';
 [...document.querySelectorAll('label.check')].find(n=>n.textContent==='Hide items with no data').querySelector('input').checked=true;
 document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
 expect(wb.chartById(id,ch)).toMatchObject({title:'Updated',columnCount:3,rowHeight:Math.round(30.5*9525),hideItemsWithNoData:true,paint});wb.undo();expect(wb.chartById(id,ch)).toMatchObject({title:'Category',hideItemsWithNoData:false});
});
it('pastes a new native view identity while retaining editable binding and paint', () => {
 const {wb,id,ch}=make();wb.updateChart(id,ch,{nativeName:'Original view',nativeCacheName:'OriginalCache'});
 const original=wb.chartById(id,ch), clip=slicerClipboard(document,original,slicerItems(wb,original));
 const pasted=readSlicerClipboard(document,clip.html);
 expect(pasted.nativeName).toBeUndefined();expect(pasted.nativeCacheName).toBeUndefined();
 expect(pasted.tableRef).toBe(original.tableRef);expect(pasted.paint).toEqual(original.paint);
 expect(original.nativeName).toBe('Original view');expect(original.nativeCacheName).toBe('OriginalCache');
});

it('hides no-data items consistently in live and printed slicers and restores them after undo', async () => {
 const {wb,id,ch}=make();wb.updateChart(id,ch,{hideItemsWithNoData:true});
 // A custom predicate on another column provides the cross-filter context.
 wb.setInput(id,0,1,'Amount');wb.setInput(id,1,1,'1');wb.setInput(id,2,1,'9');
 wb.resizeTable(id,wb.sheet(id).tables[0].id,{r1:0,c1:0,r2:2,c2:1});
 grid=createGrid({wb,sheetId:id});document.body.append(grid.el);await flush();
 wb.setFilterCriteria(id,1,{op:'gt',value:'5'});await flush();
 const labels=root=>[...root.querySelectorAll('.slicer-item')].map(n=>n.textContent);
 expect(labels(grid.el)).toEqual(['Beta']);expect(labels(buildPrintSheet(wb,id))).toEqual(['Beta']);
 wb.undo();await flush();expect(labels(grid.el)).toEqual(['Alpha','Beta']);
});
it('hides cell popovers while a slicer button owns focus and restores them on returning to the grid', async () => {
 const {wb,id,ch}=make(); wb.setNote(id,0,0,'A cell note');
 grid=createGrid({wb,sheetId:id});document.body.append(grid.el);await flush();
 expect(grid.el.querySelector('.note-pop').hidden).toBe(false);
 grid.el.querySelector(`[data-chart="${ch}"] .slicer-item`).focus();await flush();
 expect(grid.el.querySelector('.note-pop').hidden).toBe(true);
 grid.focus();await flush();expect(grid.el.querySelector('.note-pop').hidden).toBe(false);
 grid.selectChart(ch);await flush();expect(grid.el.querySelector('.note-pop').hidden).toBe(true);
});
