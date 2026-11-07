import {describe,it,expect} from 'vitest';
import {blurWideShadowAlpha} from '../src/engine/wide-shadow-blur.js';

describe('wide shadow alpha convolution',()=>{
  it('keeps finite-mask density close to a continuous Gaussian without touching color',()=>{
    const w=44,h=44,data=new Uint8ClampedArray(w*h*4);
    for(let y=13;y<31;y++)for(let x=13;x<31;x++)data.set([128,64,192,255],4*(y*w+x));
    const colors=data.slice();
    blurWideShadowAlpha(data,w,h);
    // An 18-by-18 mask at sigma=4 has about 97.56% mass on each axis.
    // Its separable center coverage is about 95.18%, not almost opaque.
    expect(data[4*(22*w+22)+3]).toBeGreaterThanOrEqual(241);
    expect(data[4*(22*w+22)+3]).toBeLessThanOrEqual(245);
    expect(data[3]).toBe(0);
    for(let i=0;i<data.length;i++)if(i%4!==3)expect(data[i]).toBe(colors[i]);
  });
  it('treats the exterior as transparent and preserves reflection symmetry',()=>{
    const w=31,h=27,data=new Uint8ClampedArray(w*h*4);
    data[4*(13*w+15)+3]=255;
    blurWideShadowAlpha(data,w,h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      expect(data[4*(y*w+x)+3]).toBe(data[4*((h-1-y)*w+w-1-x)+3]);
    }
    expect(data[4*(13*w+15)+3]).toBe(3);
  });
});
