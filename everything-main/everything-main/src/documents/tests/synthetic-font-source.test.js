import {it,expect} from 'vitest';
import {syntheticFontSource} from '../src/engine/synthetic-font-source.js';

const face=(weight,style='normal')=>({source:String(weight)+'/'+style,descriptors:{weight:String(weight),style}});
it('retains a named semibold face for synthesis',()=>{
  const upright=face(600),italic=face(600,'italic');
  expect(syntheticFontSource([upright,italic],false)).toBe(upright);
  expect(syntheticFontSource([upright,italic],true)).toBe(italic);
  expect(syntheticFontSource([upright],true)).toBe(upright);
});
it('follows normal-weight matching before selecting a named weight',()=>{
  const sources=[face(600),face(300),face(500),face(400)];
  expect(syntheticFontSource(sources,false)).toBe(sources[3]);
  expect(syntheticFontSource(sources.slice(0,3),false)).toBe(sources[2]);
  expect(syntheticFontSource(sources.slice(0,2),false)).toBe(sources[1]);
});
it('preserves implicit regular faces and rejects unknown ranges or real-bold sources',()=>{
  const implicit={source:'regular'};
  expect(syntheticFontSource([face(700),implicit],false)).toBe(implicit);
  expect(syntheticFontSource([face(700),face(900),face('300 800'),face('unknown')],false)).toBeUndefined();
  expect(syntheticFontSource([face(600,'italic')],false)).toBeUndefined();
});
