import {it,expect} from 'vitest';
import {outlineTextScale} from '../src/engine/outline-text-scale.js';
import {canvasLetterSpacing} from '../src/engine/canvas-text.js';

it('retains absolute spacing, outline thickness and the original kerning threshold at outline scale',()=>{
 for(const size of [9.5,10,12,17,1638])for(const threshold of [0,12,18]){
  const source={fontFamily:'Cambria',fontSize:size,kerning:threshold,characterSpacing:-.5,justificationSpacing:2,textScale:125,textOutline:{width:19050,color:'008080'}};
  const {factor,style}=outlineTextScale(source);
  expect(style.fontSize/factor).toBeCloseTo(size);
  expect(canvasLetterSpacing(style)/factor).toBeCloseTo(canvasLetterSpacing(source));
  expect(style.justificationSpacing/factor).toBeCloseTo(2);
  expect(style.textOutline.width/factor).toBeCloseTo(19050);
  expect(style.kerning>0&&style.fontSize>=style.kerning).toBe(threshold>0&&size>=threshold);
  expect(source.fontSize).toBe(size);expect(source.textOutline.width).toBe(19050);
 }
});
