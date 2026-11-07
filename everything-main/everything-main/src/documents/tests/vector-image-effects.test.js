import {afterEach,it,expect,vi} from 'vitest';
import {vectorImage,imageWithPixelEffects,vectorEffectSample} from '../src/engine/vector-image-effects.js';
import {paintImage} from '../src/engine/paint-image.js';
const owners=[];
afterEach(()=>{for(const image of owners.splice(0))image.close();vi.unstubAllGlobals();});
function setup(){
 const draws=[],bitmaps=[];
 vi.stubGlobal('OffscreenCanvas',class{
  constructor(width,height){this.width=width;this.height=height;}
  getContext(){return {drawImage:(...args)=>draws.push(args),getImageData:()=>({data:new Uint8ClampedArray(4)}),putImageData(){}};}
  transferToImageBitmap(){const b={width:this.width,height:this.height,close:vi.fn()};bitmaps.push(b);return b;}
 });
 const image={width:100,height:50,close:vi.fn()},transform=vi.fn();
 return {image,transform,draws,bitmaps};
}
it('retains a vector until its effect owner closes, reusing display samples and releasing all resources',()=>{
 const {image,transform,draws}=setup(),owner=imageWithPixelEffects(vectorImage(image),transform);owners.push(owner);
 expect(image.close).not.toHaveBeenCalled();
 const a=vectorEffectSample(owner,400,200),close=a.close;
 expect(a.width).toBe(400);expect(a.height).toBe(200);
 expect(vectorEffectSample(owner,400,200)).toBe(a);expect(transform).toHaveBeenCalledTimes(2);
 expect(draws[1]).toEqual([image,0,0,400,200]);
 owner.close();expect(image.close).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
 owner.close();expect(image.close).toHaveBeenCalledTimes(1);
});
it('keeps raster sources on their existing one-time effect path',()=>{
 const {image,transform}=setup(),owner=imageWithPixelEffects(image,transform);owners.push(owner);
 expect(image.close).toHaveBeenCalledTimes(1);expect(vectorEffectSample(owner,400,200)).toBe(owner);
 expect(transform).toHaveBeenCalledTimes(1);
});
it('bounds extreme crop/zoom requests and evicts older display samples across owners',()=>{
 const {image}=setup(),owner=imageWithPixelEffects(vectorImage(image),()=>{});owners.push(owner);
 const huge=vectorEffectSample(owner,1e100,1e100);
 expect(huge.width*huge.height).toBeLessThanOrEqual(4*1024*1024);expect(huge.width).toBeGreaterThan(1000);
 const closed=huge.close;
 const another=imageWithPixelEffects(vectorImage({width:100,height:50,close(){}}),()=>{});owners.push(another);
 vectorEffectSample(another,4096,1024);expect(closed).toHaveBeenCalledTimes(1);
 expect(vectorEffectSample(owner,Infinity,100)).toBe(owner);
 expect(vectorEffectSample(owner,0,100)).toBe(owner);
});
it('closes a source when the effect fails during initial decoding',()=>{
 const {image}=setup();expect(()=>imageWithPixelEffects(vectorImage(image),()=>{throw Error('effect failed');})).toThrow('effect failed');
 expect(image.close).toHaveBeenCalledTimes(1);
});
it('preserves existing reduction pixels and never replaces a larger source with a smaller capped sample',()=>{
 const {image,transform}=setup();image.width=3000;image.height=2000;
 const owner=imageWithPixelEffects(vectorImage(image),transform);owners.push(owner);
 expect(vectorEffectSample(owner,1000,800)).toBe(owner);
 expect(vectorEffectSample(owner,3000,2000)).toBe(owner);
 expect(vectorEffectSample(owner,6000,4000)).toBe(owner);
 expect(transform).toHaveBeenCalledTimes(1);
});
it('uses the full uncropped device resolution under rotated/scaled canvas transforms',()=>{
 const {image}=setup(),owner=imageWithPixelEffects(vectorImage(image),()=>{});owners.push(owner);
 const calls=[],ctx={getTransform:()=>({a:0,b:2,c:-3,d:0}),drawImage:(...args)=>calls.push(args),imageSmoothingEnabled:true,imageSmoothingQuality:'low'};
 paintImage(ctx,owner,25,10,50,20,4,5,200,80);
 const [sample,...coords]=calls[0];expect([sample.width,sample.height]).toEqual([800,600]);
 expect(coords).toEqual([200,120,400,240,4,5,200,80]);
});
