import {it,expect} from 'vitest';
import {paragraph,TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const measure=(text,s)=>({width:text.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4});
const layout=(runs,multiple=1.5,mark=10)=>{
 const d=new TextDocument([paragraph('',{runs,markFormat:{fontSize:mark},format:{lineRule:'auto',lineSpacing:multiple,spaceAfter:0}}),paragraph('Following')]);
 return layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables).lines;
};
const marker={text:'1',fontSize:40,noteMark:{kind:'footnoteRef',text:'1'}};
it('excludes note marks from additional leading but retains their full allocation',()=>{
 const base=[{text:'A',fontSize:10},marker,{text:'B',fontSize:10}];
 const note=layout(base),literal=layout(base.map(r=>({...r,noteMark:undefined})));
 expect(note[0].ascent).toBe(literal[0].ascent);expect(note[0].descent).toBe(literal[0].descent);
 expect(note[0].height).toBeCloseTo(50+12.5*.5);expect(literal[0].height).toBeCloseTo(50*1.5);
 expect(layout(base,1)[0].height).toBe(layout(base.map(r=>({...r,noteMark:undefined})),1)[0].height);
});
it('separates identically formatted literal neighbors from note marks',()=>{
 const lines=layout([{text:'A',fontSize:40},marker,{text:'B',fontSize:40}]);
 expect(lines[0].height).toBeCloseTo(75);
 expect(lines[0].fragments.map(f=>[f.text,!!f.noteMark])).toEqual([['A',false],['1',true],['B',false]]);
});
it('uses the paragraph mark for note-only leading and keeps compressed descent',()=>{
 const line=layout([marker],.8)[0];
 expect(line.spacingHeight).toBeCloseTo(12.5);expect(line.spacingAscent).toBeCloseTo(2.5);
 expect(line.height).toBeCloseTo(47.5);
 expect(layout([marker],1.5,40)[0].height).toBeCloseTo(75);
 const tall=layout([marker],1.5,50)[0];
 expect(tall.descent).toBeCloseTo(10);expect(tall.ascent).toBeCloseTo(52.5);
 expect(tall.height).toBeCloseTo(93.75);
});
