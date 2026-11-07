import {it,expect} from 'vitest';
import {measureCanvasText} from '../src/engine/canvas-text.js';
import {fontMetrics} from '../src/engine/font-metrics.js';

it.each([.5,10,10.5,11,12,16.5,17,17.5,18,1638.5])('retains page-space tracking and metrics at %s pt with one shaping call',fontSize=>{
 const style={fontSize,characterSpacing:-.5,justificationSpacing:2,kerning:17},original={...style};let calls=0;
 const ctx={fontKerning:'none',letterSpacing:'0px',wordSpacing:'0px',measureText(text){calls++;const em=Number(this.font.match(/([\d.]+)px/)[1]);return {width:Math.floor(Math.fround(em)*100)/100*1.5+3*parseFloat(this.letterSpacing)+parseFloat(this.wordSpacing)};}};
 const result=measureCanvasText(ctx,'A B',style);
 expect(result.width).toBeCloseTo(fontSize*4/3*1.5+3*(-.5)*4/3+2,4);
 expect(calls).toBe(1);expect(style).toEqual(original);
 expect(result.ascent).toBe(fontMetrics(style).ascent);expect(result.descent).toBe(fontMetrics(style).descent);
 expect(ctx.fontKerning).toBe(fontSize>=17?'normal':'none');
});

it('keeps a half-point kerning threshold enabled at a half-point font size',()=>{
 const ctx={fontKerning:'none',letterSpacing:'0px',wordSpacing:'0px',measureText:()=>({width:1})};
 measureCanvasText(ctx,'AV',{fontSize:.5,kerning:.5});
 expect(ctx.fontKerning).toBe('normal');
});
