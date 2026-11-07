import {it,expect} from 'vitest';
import {paragraph} from '../src/engine/model.js';
import {layoutDocument,caretRect,selectionRects} from '../src/engine/layout.js';
const page={width:300,height:200,left:20,right:20,top:20,bottom:20,gap:24};
const measure=(text,style)=>({width:text.length*style.fontSize*.8,ascent:style.fontSize,descent:style.fontSize*.2});
const large=text=>paragraph(text,{runs:[{text,fontSize:200}]});
it('preserves oversized body text in editable pagination with physical-page editing bounds',()=>{
 const ps=[large('A'),paragraph('After')],before=JSON.stringify(ps);
 const l=layoutDocument(ps,measure,page);
 expect(l.pageCount).toBe(2);expect(l.lines.map(x=>x.page)).toEqual([0,1]);expect(l.lines[0].y).toBe(20);expect(JSON.stringify(ps)).toBe(before);
 for(const r of [caretRect(l,0),...selectionRects(l,0,1)]){expect(r.y).toBeGreaterThanOrEqual(0);expect(r.y+r.height).toBeLessThanOrEqual(page.height);}
});
it('advances past occupied pages and handles consecutive oversized lines without blank pages',()=>{
 const ps=[paragraph('Before'),large('AB'),paragraph('After')];
 const l=layoutDocument(ps,measure,page);
 expect(l.pageCount).toBe(4);expect(l.lines.map(x=>x.page)).toEqual([0,1,2,3]);expect(l.lines.map(x=>x.y)).toEqual([20,20,20,20]);
});
it('honors explicit paragraph page breaks with editable oversized lines',()=>{
 const ps=[large('A'),large('B')];ps[1].format={pageBreakBefore:true};
 const l=layoutDocument(ps,measure,page);expect(l.pageCount).toBe(2);expect(l.lines.map(x=>x.page)).toEqual([0,1]);
});
it('clips selection coverage from expanded automatic leading to the physical page',()=>{
 const p=paragraph('A',{runs:[{text:'A',fontSize:100}],format:{lineRule:'auto',lineSpacing:3}});
 const l=layoutDocument([p,paragraph('After')],measure,page);
 expect(l.lines[0].height).toBeGreaterThan(page.height);
 for(const r of selectionRects(l,0,1))expect(r.y+r.height).toBeLessThanOrEqual(page.height);
});
it('keeps the separate shifted-text overflow guard',()=>{
 const p=paragraph('A',{runs:[{text:'A',fontSize:200,baselineShift:12}]});
 expect(()=>layoutDocument([p],measure,page)).toThrow(/page height/);
});
