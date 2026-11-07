import {it,expect} from 'vitest';
import {paragraph,TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
const measure=(text,s)=>({width:text.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4});
const make=text=>paragraph('',{runs:[{text,fontSize:12}],markFormat:{fontSize:24},format:{spaceBefore:0,spaceAfter:0}});
const lines=p=>layoutDocument([p],measure).lines;
it.each(['Text','Text   ','\tText','Text\vcontinued'])('uses text metrics rather than an oversized terminal mark: %j',text=>{
 const p=make(text);expect(lines(p).every(l=>l.height===15)).toBe(true);expect(p.markFormat.fontSize).toBe(24);
});
it.each(['','   ','\t'])('retains oversized mark metrics for an empty or whitespace-only line: %j',text=>{
 expect(lines(make(text))[0].height).toBe(30);
});
it('ignores manual-break metrics on text lines and keeps blank break/mark metrics distinct',()=>{
 const p=make('Text\v');expect(lines(p).map(l=>l.height)).toEqual([15,30]);
 p.runs=[{text:'Text',fontSize:12},{text:'\v\v',fontSize:36}];expect(lines(p).map(l=>l.height)).toEqual([15,45,30]);
});
it('retains mark formatting when text is removed, restores geometry on undo and keeps a usable caret',()=>{
 const doc=new TextDocument([make('Text')]);doc.select(0,4);doc.replace('');
 const layout=layoutDocument(doc.paragraphs,measure);expect(layout.lines[0].height).toBe(30);expect(caretRect(layout,0).height).toBeGreaterThan(0);
 expect(doc.paragraphs[0].markFormat.fontSize).toBe(24);doc.undo();expect(lines(doc.paragraphs[0])[0].height).toBe(15);
});
