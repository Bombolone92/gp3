import { it, expect } from 'vitest';
import { contractionLimit, contractionMetrics } from '../src/engine/justification-contraction.js';
import { measureTextGeometry } from '../src/engine/text-geometry.js';
import { TextDocument, paragraph } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

const measure = (text, style) => ({ width: [...text].reduce((sum,c) => sum + (c === ' ' ? 5 + (style.justificationSpacing || 0) : c === 'i' ? 3 : c === 'W' ? 14 : 10), 0), ascent: 20, descent: 5 });
const text = Array(8).fill('aa').join('  ');
const document = (mode=15, value=text, alignment='both') => new TextDocument([paragraph(value,{format:{alignment}})], {width:3300,left:0,right:0,top:0,bottom:0,compatibilityMode:mode});
const layout = doc => layoutDocument(doc.paragraphs,measure,pageGeometry(doc.pageSettings));

it('balances twice the proportional shrink against expansion of the shorter line',()=>{
 expect(contractionLimit(230,200,70,60,220)).toBeCloseTo(10/70);
 expect(contractionLimit(230,200,70,60,218)).toBeNull();
 expect(contractionLimit(230,100,70,20,212)).toBeNull();
});
it('contracts final lines only in modern justified paragraphs and keeps source runs unchanged',()=>{
 const doc=document(),before=doc.snapshot(),result=layout(doc);
 expect(result.lines).toHaveLength(1);
 expect(result.lines[0].fragments.map(f=>f.text).join('')).toBe(text);
 expect(result.lines[0].stops.at(-1).x).toBeCloseTo(220);
 expect(doc.snapshot()).toEqual(before);
 expect(layout(document(14)).lines).toHaveLength(2);
 expect(layout(document(15,text,'left')).lines).toHaveLength(2);
});
it('keeps contracted caret hits and selection widths on the measured space advances',()=>{
 const result=layout(document()),line=result.lines[0];
 for(const offset of [2,3,4,18,30]) {
  const caret=caretRect(result,offset);
  expect(hitTest(result,caret.page,caret.x,caret.y+caret.height/2)).toBe(offset);
 }
 const width=line.stops[3].x-line.stops[2].x;
 expect(width).toBeCloseTo(5-10/14);
 expect(selectionRects(result,2,3)[0].width).toBeCloseTo(width);
});
it('corrects a native shaper that omits negative spacing at fragment starts',()=>{
 const native=(text,style)=>({width:text.length*5+(text.replace(/^ +/,'').match(/ /g)?.length||0)*(style.justificationSpacing||0),ascent:10,descent:3});
 const measured=measureTextGeometry('  a b',{fontFamily:'Test',fontSize:10,justificationSpacing:-1},native);
 expect(measured.width).toBe(22);
 expect(measured.textOffsetX).toBe(-2);
 expect(measureTextGeometry('  a b',{fontFamily:'Test',fontSize:10,justificationSpacing:-1},measure).width).toBe(measure('  a b',{justificationSpacing:-1}).width);
});
it('detects fixed-pitch advances without font-name rules and reuses identical face metrics',()=>{
 let calls=0;
 const metrics=contractionMetrics((t,s)=>{calls++;return measure(t,s);});
 expect(metrics({fontFamily:'Example',fontSize:20})).toBe(5);
 const previous=calls;
 expect(metrics({fontFamily:'Example',fontSize:20})).toBe(5);
 expect(calls).toBe(previous);
 expect(contractionMetrics(t=>({width:t.length*8}))({fontFamily:'Any name'})).toBe(0);
});
it.each(['\u00a0','\u202f','\u2007'])('does not create a line-break opportunity before nonbreaking whitespace %s',space=>{
 const prefix=Array(7).fill('aa').join('  '),doc=document(15,prefix+'  a'+space+'aaaa');
 doc.pageSettings.width=3225;
 expect(layout(doc).lines[0].fragments.map(f=>f.text).join('').trimEnd()).toBe(prefix);
});
