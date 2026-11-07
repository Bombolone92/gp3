import {it,expect} from 'vitest';
import {paragraph,TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect,PAGE} from '../src/engine/layout.js';
const measure=(text,s)=>({width:text.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4});
const make=(text,mark=4)=>paragraph('',{runs:[{text,fontSize:24}],markFormat:{fontSize:mark},format:{spaceBefore:0,spaceAfter:0}});
it('uses the terminal mark instead of the break run, retaining both stored formats',()=>{
 const p=make('\f');const layout=layoutDocument([p],measure);
 expect(layout.lines[0].height).toBe(5);expect(layout.lines[0].pageBreakWithMark).toBe(true);
 expect(p.runs[0].fontSize).toBe(24);expect(p.markFormat.fontSize).toBe(4);
 expect(caretRect(layout,1).height).toBeGreaterThan(0);
});
it('keeps visible text metrics and uses the terminal mark for blank lines',()=>{
 for(const [text,height] of [['X',15],[' ',5]]){
  const p=make('\f');p.runs.unshift({text,fontSize:12});
  expect(layoutDocument([p],measure).lines[0].height).toBe(height);
 }
 expect(layoutDocument([make('X\f')],measure).lines[0].height).toBe(30);
 expect(layoutDocument([make('\f',36)],measure).lines[0].height).toBe(45);
});
it('retains manual line-break, interior page-break and split-mark metrics',()=>{
 for(const text of ['\v','\fX'])expect(layoutDocument([make(text)],measure).lines[0].height).toBe(30);
 const split=layoutDocument([make('\f')],measure,{...PAGE,splitPgBreakAndParaMark:true});
 expect(split.lines[0].height).toBe(30);expect(split.lines[1].virtual).toBe(false);
 expect(split.lines[1].page).toBe(1);expect(split.lines[1].y).toBe(96);
});
it('restores normal run metrics when text is inserted before the break and restores mark metrics on undo',()=>{
 const d=new TextDocument([make('\f')]);d.select(0);d.replace('X');
 expect(layoutDocument(d.paragraphs,measure).lines[0].height).toBe(30);
 d.undo();expect(layoutDocument(d.paragraphs,measure).lines[0].height).toBe(5);
});
