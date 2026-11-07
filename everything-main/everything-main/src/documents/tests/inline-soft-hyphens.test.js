import {it,expect} from 'vitest';
import {paragraph,RUN_FORMAT} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
const measure=t=>({width:t.length*8,ascent:12,descent:4});
const image={assetId:'picture',width:90*12700,height:30*12700};
const layout=(tail,mode)=>{
 const p=paragraph('');p.runs=[{...RUN_FORMAT,text:'\ufffc',image},{...RUN_FORMAT,text:tail}];
 return layoutDocument([p],measure,{width:96,height:500,left:0,right:0,top:0,bottom:0,compatibilityMode:mode});
};
it('retains modern oversized-image trailing spaces and discretionary offsets without an extra line',()=>{
 for(const tail of ['\u00ad','\u00ad\u00ad',' ','  \u00ad']){
  const l=layout(tail,15);expect(l.lines).toHaveLength(1);expect(l.lines[0].end).toBe(tail.length+1);
  expect(l.lines[0].fragments.map(f=>f.text).join('').replaceAll(' ','')).toBe('\ufffc');
  for(let offset=1;offset<=tail.length+1;offset++)expect(l.lines[0].stops.map(s=>s.offset)).toContain(offset);
  expect(caretRect(l,1).page).toBe(0);
 }
});
it('preserves legacy extra lines and modern visible-text and manual-break advances',()=>{
 for(const mode of [12,14])for(const tail of ['\u00ad',' '])expect(layout(tail,mode).lines).toHaveLength(2);
 expect(layout('\u00adABC',15).lines.map(l=>l.fragments.map(f=>f.text).join(''))).toEqual(['\ufffc','ABC']);
 expect(layout('\u00ad\v',15).lines).toHaveLength(2);
 expect(layout('\u00ad\v',14).lines).toHaveLength(3);
 expect(layout('\tABC',15).lines.length).toBeGreaterThan(1);
});
it('keeps a painted optional hyphen on picture-only metrics without losing source caret offsets',()=>{
 const render=(tail,height=18)=>{
  const p=paragraph('');p.runs=[{...RUN_FORMAT,text:'\ufffc',image:{...image,width:54*12700,height:height*12700}},{...RUN_FORMAT,text:tail}];
  return layoutDocument([p],measure,{width:96,height:500,left:0,right:0,top:0,bottom:0,compatibilityMode:15});
 };
 const optional=render('\u00adABCD'),literal=render('-ABCD');
 expect(optional.lines.map(l=>l.fragments.map(f=>f.text).join(''))).toEqual(['\ufffc-','ABCD']);
 expect(optional.lines[0].height).toBe(literal.lines[0].height-4);
 expect(optional.lines[1].baseline).toBe(literal.lines[1].baseline-4);
 expect(optional.lines[0].end).toBe(2);expect(optional.lines[1].start).toBe(2);
 expect(optional.lines[0].stops.map(s=>s.offset)).toEqual([0,1,2]);
 expect(render('\u00adABCD',6).lines[0].height).toBe(16);
 // Actual text before the optional hyphen retains ordinary text descent.
 expect(render('a\u00adABCD').lines[0].height).toBe(render('a-ABCD').lines[0].height);
});
