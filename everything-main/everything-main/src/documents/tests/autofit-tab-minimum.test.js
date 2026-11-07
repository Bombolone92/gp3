import {it,expect} from 'vitest';
import {paragraph} from '../src/engine/model.js';
import {cellIntrinsicWidths} from '../src/engine/intrinsic-widths.js';

// One point per character isolates tab geometry from installed font metrics.
const minimum=(text,format={},mode=15,interval=720)=>cellIntrinsicWidths(
 {margins:{left:40,right:40},content:[{paragraph:paragraph(text,{format}),index:0}]},
 text=>({width:text.length*4/3,ascent:1,descent:0}),
 {compatibilityMode:mode,defaultTabStop:interval},undefined,[]).min*.75;

it('measures modern tab demand from the real origin and preserves legacy indentation',()=>{
 for(const mode of [12,14]) expect(minimum('\tX',{indentLeft:540},mode)).toBeCloseTo(59,6);
 expect(minimum('\tX',{indentLeft:540},15)).toBeCloseTo(41,6);
 expect(minimum('X\t',{indentLeft:540},12)).toBeCloseTo(57,6);
 expect(minimum('X\t',{indentLeft:540},15)).toBeCloseTo(39,6);
});
it('does not force a legacy leading tab to reserve a positive first-line indent',()=>{
 expect(minimum('\t',{firstLine:540},12,360)).toBeCloseTo(22,6);
 expect(minimum('\t',{firstLine:540},15,360)).toBeCloseTo(40,6);
 expect(minimum('\t',{indentLeft:540,firstLine:-540},15)).toBeCloseTo(31,6);
});
it('takes the largest tab field demand rather than adding all tab advances',()=>{
 expect(minimum('\t\t',{indentLeft:540},12)).toBeCloseTo(58,6);
 expect(minimum('\t\t\t',{indentLeft:540},12)).toBeCloseTo(67,6);
});
it('resumes default stops beyond decimal stops for intrinsic sizing only',()=>{
 const tabs=[{alignment:'decimal',position:900}];
 expect(minimum('\tX',{tabs},15,360)).toBeCloseTo(59,6);
 expect(minimum('\tX',{tabs},15,720)).toBeCloseTo(77,6);
});
it('does not add the empty-cell writing reserve beyond nonempty paragraph indents',()=>{
 expect(minimum(' ',{indentLeft:540})).toBeCloseTo(31,6);
 expect(minimum('\v',{indentLeft:540})).toBeCloseTo(31,6);
 expect(minimum('',{indentLeft:540})).toBeCloseTo(4.3,6);
});
it('uses explicit decimal stops when there are multiple authored stops',()=>{
 for(const mode of [12,14,15]) {
  for(const alignment of ['left','decimal']) {
   const tabs=[{alignment:'decimal',position:720},{alignment,position:1440}];
   expect(minimum('\t12.3',{tabs},mode)).toBeCloseTo(42,6);
   expect(minimum('\t123',{tabs},mode)).toBeCloseTo(40,6);
  }
 }
});
