import {it,expect} from 'vitest';
import {paragraph,TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
const measure=(text,s)=>({width:text.length*5,ascent:10,descent:2});
const make=(text,format={})=>paragraph(text,{format:{spaceBefore:0,spaceAfter:0,...format}});
const layout=ps=>layoutDocument(ps,measure);
it('excludes isolated before/after spacing without changing line placement',()=>{
 const ps=[make('Before'),make('Shaded',{paragraphShading:'00AABB',spaceBefore:12,spaceAfter:18}),make('After')];
 const a=layout(ps);expect(a.lines[1].paragraphBackground).toMatchObject({before:0,after:0});
 ps[1].format.paragraphShading='auto';const b=layout(ps);
 expect(a.lines.map(l=>[l.y,l.baseline,l.height])).toEqual(b.lines.map(l=>[l.y,l.baseline,l.height]));
});
it.each([[6,24,0],[30,24,16]])('allocates a %spt collapsed gap once between different fills', (before,afterPixels,beforePixels)=>{
 const r=layout([make('A',{paragraphShading:'00AABB',spaceAfter:18}),make('B',{paragraphShading:'DDAA00',spaceBefore:before})]);
 expect(r.lines[0].paragraphBackground.after).toBe(afterPixels);expect(r.lines[1].paragraphBackground.before).toBe(beforePixels);
});
it('does not bridge an unshaded paragraph, table-independent page boundary or final paragraph tail',()=>{
 const r=layout([make('A',{paragraphShading:'00AABB',spaceAfter:18}),make('B'),make('C',{paragraphShading:'DDAA00',spaceAfter:18}),make('D',{paragraphShading:'00AABB',pageBreakBefore:true,spaceBefore:30})]);
 for(const l of r.lines.filter(l=>l.paragraphBackground))expect(l.paragraphBackground).toMatchObject({before:0,after:0});
 expect(r.lines.at(-1).page).toBe(1);
});
it('updates adjacency when a fill is removed and restores its exact geometry on undo',()=>{
 const doc=new TextDocument([make('A',{paragraphShading:'00AABB',spaceAfter:18}),make('B',{paragraphShading:'DDAA00',spaceBefore:30})]);
 const original=layout(doc.paragraphs).lines.map(l=>l.paragraphBackground);doc.select(2);doc.setParagraphFormat({paragraphShading:'auto'});
 expect(layout(doc.paragraphs).lines[0].paragraphBackground.after).toBe(0);doc.undo();expect(layout(doc.paragraphs).lines.map(l=>l.paragraphBackground)).toEqual(original);
});
it('leaves the gap unshaded when adjacent paragraph writing bounds differ',()=>{
 const r=layout([make('A',{paragraphShading:'00AABB',spaceAfter:18}),make('B',{paragraphShading:'DDAA00',spaceBefore:30,indentLeft:24})]);
 for(const l of r.lines)expect(l.paragraphBackground).toMatchObject({before:0,after:0});
});
