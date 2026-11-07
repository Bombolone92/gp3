import {it,expect} from 'vitest';
import {paragraph,TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
const measure=(text,s)=>({width:text.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4});
const line=p=>layoutDocument([p],measure).lines[0];
const make=(space,position)=>paragraph('',{runs:[...(position==='leading'?[]:[{text:'First',fontSize:12}]),{text:space,fontSize:36},...(position==='trailing'?[]:[{text:'Last',fontSize:12}])],markFormat:{fontSize:12}});
for(const position of ['leading','middle','trailing']){
 it.each([' ','\u2003','\t'])(`ignores blank fonts in ${position} position, preserving advances: %j`,space=>{
  const p=make(space,position),large=line(p);expect(large.height).toBe(15);
  const blank=p.runs.find(r=>r.fontSize===36);blank.fontSize=12;const small=line(p);
  expect(small.height).toBe(large.height);
  if(space!=='\t')expect(large.width).toBeGreaterThan(small.width);
 });
 it(`retains NBSP font metrics in ${position} position`,()=>expect(line(make('\u00a0',position)).height).toBe(45));
}
it('activates blank-line paragraph-mark metrics after text deletion and restores text metrics on undo',()=>{
 const p=paragraph('',{runs:[{text:'Text',fontSize:12},{text:' ',fontSize:36}],markFormat:{fontSize:24}}),doc=new TextDocument([p]);
 expect(line(doc.paragraphs[0]).height).toBe(15);doc.select(0,4);doc.replace('');
 expect(line(doc.paragraphs[0]).height).toBe(30);expect(doc.paragraphs[0].runs[0].fontSize).toBe(36);
 expect(caretRect(layoutDocument(doc.paragraphs,measure),0).height).toBeGreaterThan(0);
 doc.undo();expect(line(doc.paragraphs[0]).height).toBe(15);
});
