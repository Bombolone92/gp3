import {it,expect} from 'vitest';
import {paragraph,TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
const measure=(text,s)=>({width:text.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4});
const layout=doc=>layoutDocument(doc.paragraphs,measure);
it.each(['Text','Text   ','\u00a0'])('ignores a large manual-break font after text: %j',text=>{
 const p=paragraph('',{runs:[{text,fontSize:12},{text:'\v',fontSize:36},{text:'Next',fontSize:12}],markFormat:{fontSize:24}});
 expect(layoutDocument([p],measure).lines.map(l=>l.height)).toEqual([15,15]);
});
it('uses the break font after deleting the text, restores on undo, and retains usable break carets',()=>{
 const p=paragraph('',{runs:[{text:'Text',fontSize:12},{text:'\v',fontSize:36},{text:'Next',fontSize:12}],markFormat:{fontSize:24}}),doc=new TextDocument([p]);
 expect(layout(doc).lines[0].height).toBe(15);doc.select(0,4);doc.replace('');
 expect(layout(doc).lines[0].height).toBe(45);expect(caretRect(layout(doc),0).height).toBeGreaterThan(0);
 expect(doc.paragraphs[0].runs.find(r=>r.text.includes('\v')).fontSize).toBe(36);
 doc.undo();expect(layout(doc).lines.map(l=>l.height)).toEqual([15,15]);expect(caretRect(layout(doc),4).height).toBeGreaterThan(0);
});
