// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Workbook, DEFAULT_ROW_HEIGHT } from '../src/core/workbook.js';
import { createGrid } from '../src/ui/grid.js';

beforeEach(() => {
 Object.defineProperty(HTMLElement.prototype,'clientWidth',{configurable:true,get(){return 800;}});
 Object.defineProperty(HTMLElement.prototype,'clientHeight',{configurable:true,get(){return 400;}});
 HTMLCanvasElement.prototype.getContext=()=>({measureText:t=>({width:t.length*7}),font:''});
 Element.prototype.scrollTo=function(){}; globalThis.matchMedia=()=>({matches:false,addEventListener(){}});
 globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=id=>clearTimeout(id);
});
let grid;
afterEach(()=>{grid?.destroy();grid=null;document.body.replaceChildren();vi.restoreAllMocks();});
const ROW=Math.round(DEFAULT_ROW_HEIGHT); // a default row on screen at 100% (the grid snaps rows to whole pixels)
const flush=()=>new Promise(r=>setTimeout(r,10));
const merge={r1:1,c1:1,r2:3,c2:3};
const side=(k,bc,bs='thin')=>({[k]:true,[`${k}Border`]:{bc,bs}});
async function mount(cells,extra={}){
 const wb=new Workbook({sheets:[{cells,merges:[merge],colWidths:{1:40,2:100,3:60},rowHeights:{1:20,2:30,3:50},...extra}]});
 const id=wb.activeSheetId;grid=createGrid({wb,sheetId:id,announce(){}});document.body.append(grid.el);await flush();
 return {wb,id,node:()=>grid.el.querySelector('#gc-1-1'),paint:()=>grid.el.querySelector('.merged-border-paint')};
}

it('draws independently styled perimeter segments without stretching the anchor or painting internal edges',async()=>{
 const {node,paint}=await mount({'1,1':{v:'Merged',s:{bt:true,bb:true,bl:true,br:true,bc:'red'}},'3,3':{s:side('bb','blue','double')}});
 expect(['bt','bb','bl','br'].some(k=>node().classList.contains(k))).toBe(false);
 const parts=[...paint().children];expect(parts).toHaveLength(3);
 expect(parts.map(p=>[p.style.left,p.style.top,p.style.width,p.style.height].map(n=>+parseFloat(n).toFixed(6)))).toEqual([
  [0,0,40,100],[140,0,60,100],[0,0,200,20],
 ]);
 expect(parts[0].style.borderTopColor).toBe('red');expect(parts[1].style.borderBottomStyle).toBe('double');
 expect(parts[2].style.borderLeftColor).toBe('red');
 expect(paint().getAttribute('aria-hidden')).toBe('true');expect(paint().style.pointerEvents).toBe('none');
 expect(node().textContent).toBe('Merged');
});

it('compares the actual merged edge and restores the neighbor after undo',async()=>{
 const {wb,id}=await mount({'3,1':{s:side('bb','red')},'4,1':{s:side('bt','blue')},'4,2':{s:side('bt','green')}});
 expect(grid.el.querySelector('#gc-4-1').classList.contains('bt')).toBe(true); // lower cell wins a tie
 expect(grid.el.querySelector('#gc-4-2').classList.contains('bt')).toBe(true);
 wb.applyStyle(id,{r1:3,c1:2,r2:3,c2:2},side('bb','red','medium')); await flush();
 expect(grid.el.querySelector('#gc-4-2').classList.contains('bt')).toBe(false);
 wb.undo();await flush();expect(grid.el.querySelector('#gc-4-2').classList.contains('bt')).toBe(true);
});

it('does not promote an interior border to the bottom of a merge when its last row is hidden',async()=>{
 const {node,paint}=await mount({'1,1':{v:'Hidden end'},'2,1':{s:side('bb','red')},'3,1':{s:side('bb','blue')}},{hiddenRows:[3]});
 expect(node().classList.contains('bb')).toBe(false);expect(paint()).toBeNull();
});

it('retains perimeters on empty anchors and removes hidden row segments',async()=>{
 const {paint}=await mount({'1,1':{s:side('bl','red')},'2,1':{s:side('bl','blue')},'3,1':{s:side('bl','green')}},{hiddenRows:[1]});
 expect(paint().style.height).toBe('80px');
 expect([...paint().children].map(p=>[p.style.top,p.style.height,p.style.borderLeftColor])).toEqual([
  ['0px','30px','blue'],['30px','50px','green'],
 ]);
});

it('keeps uniform outlines as native cell borders and does not allocate an overlay',async()=>{
 const cells={};for(let r=1;r<=3;r++)for(let c=1;c<=3;c++)cells[`${r},${c}`]={s:{bt:r===1,bb:r===3,bl:c===1,br:c===3,bc:'red',bs:'thick'}};
 const {node,paint}=await mount(cells);
 expect(['bt','bb','bl','br'].every(k=>node().classList.contains(k))).toBe(true);
 expect(node().style.borderBottomWidth).toBe('3px');expect(paint()).toBeNull();
});

it('paints partial sides in frozen copies without adding accessible cells',async()=>{
 const {wb,id}=await mount({'1,1':{v:'Frozen merge'},'3,1':{s:side('bb','red')},'3,3':{s:side('bb','blue')}});
 wb.setFrozen(id,4,0);await flush();
 const frozen=grid.el.querySelector('.frz-rows .frz-cells');
 expect(frozen.querySelector('.merged-border-paint').children).toHaveLength(2);
 expect(frozen.querySelectorAll('[role="gridcell"], [id^="gc-"]')).toHaveLength(0);
});

it('bounds perimeter reads to the viewport for very tall merges and positions scrolled segments in the full box',async()=>{
 const wb=new Workbook({sheets:[{rows:100001,cols:6,merges:[{r1:0,c1:0,r2:99999,c2:2}],
  cells:{'0,0':{v:'Tall merge'},'50000,0':{s:side('bl','red')}}}]});
 const get=vi.spyOn(wb.sheets[0].cells,'get');
 grid=createGrid({wb,sheetId:wb.activeSheetId,announce(){}});document.body.append(grid.el);await flush();
 expect(get.mock.calls.length).toBeLessThan(2000);
 get.mockClear();
 grid.viewport.scrollTop=ROW*50000;grid.viewport.dispatchEvent(new Event('scroll'));await flush();
 expect(get.mock.calls.length).toBeLessThan(2000);
 const paint=grid.el.querySelector('.merged-border-paint');expect(paint).not.toBeNull();
 expect(parseFloat(paint.firstElementChild.style.top)).toBe(ROW*50000);
 expect(paint.firstElementChild.style.borderLeftColor).toBe('red');
});
