import {it,expect} from 'vitest';
import {bitmapDisplayFrame,paintDisplayImage} from '../src/engine/paint-image.js';

it('leaves rotation, reflection, invalid density and subpixel footprints on the established path',()=>{
 const m={a:1,b:0,c:0,d:1,e:0,f:0};
 for(const matrix of [{...m,b:.1},{...m,c:.1},{...m,a:-1},{...m,d:-1},{...m,a:Infinity}])expect(bitmapDisplayFrame(matrix,1,1,1,20,20)).toBeUndefined();
 for(const scale of [undefined,0,NaN,Infinity])expect(bitmapDisplayFrame(m,scale,1,1,20,20)).toBeUndefined();
 expect(bitmapDisplayFrame(m,1,1,1,.2,20)).toBeUndefined();
 expect(m).toEqual({a:1,b:0,c:0,d:1,e:0,f:0});
});

it('preserves exact whole-twip extents across fractional scales without losing a twip to floating-point arithmetic',()=>{
 for(const scale of [1,1.25,2,3,4])for(let twips=1;twips<400;twips++){
  const size=twips/15,m={a:scale,b:0,c:0,d:scale,e:.3,f:.7};
  const frame=bitmapDisplayFrame(m,scale,0,0,size,size);
  if(Math.round(size*scale)>0){expect(frame).toBeDefined();expect(frame[2]*scale).toBeCloseTo(Math.round(size*scale),10);}
 }
});

it('paints through one transform observation and retains the caller smoothing state',()=>{
 const matrix={a:2,b:0,c:0,d:2,e:.2,f:.4},calls=[];let observations=0;
 const ctx={getTransform(){observations++;return matrix;},imageSmoothingEnabled:true,imageSmoothingQuality:'medium',
  globalCompositeOperation:'source-over',drawImage(...args){calls.push(args);}};
 const image={width:625,height:300};paintDisplayImage(ctx,image,80.2,60.2,103.50005249343832,49.68005249343832,2);
 expect(observations).toBe(1);expect(calls).toHaveLength(1);expect(calls[0][0]).toBe(image);
 const [,x,y,width,height]=calls[0];
 for(const value of [matrix.e+x*2,matrix.f+y*2,width*2,height*2])expect(value).toBeCloseTo(Math.round(value),10);
 expect(ctx.imageSmoothingQuality).toBe('medium');
 ctx.imageSmoothingEnabled=false;paintDisplayImage(ctx,image,80.2,60.2,103.50005249343832,49.68005249343832,2);
 expect(calls[1].slice(1)).toEqual([80.2,60.2,103.50005249343832,49.68005249343832]);
});
