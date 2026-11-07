import { describe, it, expect } from 'vitest';
import { paintImage } from '../src/engine/paint-image.js';
const identity=()=>({a:1,b:0,c:0,d:1});
describe('picture sampling state', () => {
  it.each(['low','medium','high'])('restores %s quality after downsampling', quality => {
    const image={width:1000,height:500},calls=[];
    const ctx={imageSmoothingQuality:quality,imageSmoothingEnabled:true,globalAlpha:.4,getTransform:identity,
      drawImage(...args){calls.push([this.imageSmoothingQuality,...args]);}};
    paintImage(ctx,image,0,0,1000,500,5,6,100,50);
    expect(calls).toEqual([['high',image,0,0,1000,500,5,6,100,50]]);
    expect(ctx.imageSmoothingQuality).toBe(quality);expect(ctx.globalAlpha).toBe(.4);
  });
  it('restores quality after a failed draw', () => {
    const ctx={imageSmoothingEnabled:true,imageSmoothingQuality:'medium',getTransform:identity,drawImage(){throw new Error('decode');}};
    expect(()=>paintImage(ctx,{width:100,height:100},0,0,10,10)).toThrow('decode');
    expect(ctx.imageSmoothingQuality).toBe('medium');
  });
  it.each([false,true])('preserves unsmoothed or enlarged pictures (%s)',enabled=>{
    const calls=[],ctx={imageSmoothingEnabled:enabled,imageSmoothingQuality:'low',getTransform:identity,drawImage(){calls.push(this.imageSmoothingQuality);}};
    paintImage(ctx,{width:100,height:50},0,0,enabled?200:10,enabled?100:5);
    expect(calls).toEqual(['low']);expect(ctx.imageSmoothingEnabled).toBe(enabled);
  });
});
