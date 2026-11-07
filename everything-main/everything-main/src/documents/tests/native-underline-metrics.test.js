import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nativeUnderlineMetrics } from '../src/engine/native-underline-metrics.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
import { underlineGeometry, underlineSpan } from '../src/engine/underlines.js';
import { measureTextGeometry } from '../src/engine/text-geometry.js';
const ref=JSON.parse(readFileSync('tests/fixtures/native-underlines/reference.json'));
const geometry={Arial:[1921,434],Calibri:[1950,550],'Times New Roman':[1912,443],Cambria:[1946,455]};

it('uses independently recorded post metrics for every reviewed face and size',()=>{
  for(const row of ref.cases){
    const [ascent,descent]=geometry[row.font],base={ascent:ascent/2048,descent:descent/2048};
    const face=nativeUnderlineMetrics(row.font,row,base);
    const actual=fontMetrics({fontFamily:row.font,fontSize:row.size,bold:row.bold,italic:row.italic},{fontBoundingBoxAscent:ascent,fontBoundingBoxDescent:descent},face);
    expect(actual.nativeUnderlineOffset*.75).toBeCloseTo(row.postOffset,8);
    expect(actual.nativeUnderlineThickness*.75).toBeCloseTo(row.postThickness,8);
    expect(Math.abs(actual.nativeUnderlineOffset*.75-row.offset)).toBeLessThan(.061);
    expect(Math.abs(actual.nativeUnderlineThickness*.75-row.rect.height)).toBeLessThan(.061);
    expect(actual.ascent).toBeCloseTo(base.ascent*row.size*4/3,8);expect(actual.descent).toBeCloseTo(base.descent*row.size*4/3,8);
  }
});

it('selects ordinary native rules per paint span and preserves the separate complex-pattern approximation',()=>{
  const m={underlineOffset:2.4,underlineThickness:1.2,nativeUnderlineOffset:217/2048*24,nativeUnderlineThickness:215/2048*24};
  for(const pattern of ['single','words','dotted','dash','dashLong','dotDash','dotDotDash'])expect(underlineGeometry(pattern,m)).toEqual({offset:m.nativeUnderlineOffset,thickness:m.nativeUnderlineThickness});
  for(const pattern of ['double','thick','dottedHeavy','dashedHeavy','wave','wavyHeavy','wavyDouble'])expect(underlineGeometry(pattern,m)).toEqual({offset:2.4,thickness:1.2});
  const transformed=measureTextGeometry('Text',{fontFamily:'Arial',fontSize:18,baselineShift:3,textScale:150},()=>({...m,width:30,ascent:20,descent:4}));
  const span=underlineSpan({underline:true},transformed,0,transformed.width);
  expect(span.offset).toBeCloseTo(m.nativeUnderlineOffset-4,8);expect(span.thickness).toBe(m.nativeUnderlineThickness);expect(span.width).toBe(45);
});

it('leaves unknown, substituted and differently measured faces unchanged',()=>{
  const measured={ascent:1921/2048,descent:434/2048};
  expect(nativeUnderlineMetrics('Other face',{},measured)).toBe(measured);
  expect(nativeUnderlineMetrics('Calibri',{},measured)).toBe(measured);
  for(const changed of [{...measured,ascent:1},{...measured,descent:.3}])expect(nativeUnderlineMetrics('Arial',{},changed)).toBe(changed);
  const a=fontMetrics({fontFamily:'Unknown',fontSize:18},{fontBoundingBoxAscent:21,fontBoundingBoxDescent:5},measured);
  expect(a.underlineOffset).toBeCloseTo(2.4,8);expect(a.underlineThickness).toBeCloseTo(1.2,8);
  expect(nativeUnderlineMetrics(' ARIAL ',{bold:true},measured).underlineThickness).toBe(215/2048);
});
