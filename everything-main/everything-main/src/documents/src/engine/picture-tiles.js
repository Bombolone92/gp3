import { imageCropRect } from './images.js';
import { vectorEffectSample } from './vector-image-effects.js';

export function readPictureTile(node) {
  if(node.children.length || node.textContent.trim())throw new Error('nonempty picture tile properties');
  const defaults={tx:0,ty:0,sx:100000,sy:100000,algn:'tl',flip:'none'},tile={...defaults};
  for(const attr of node.attributes) {
    if(attr.namespaceURI)continue;
    const {name}=attr,raw=attr.value.trim();
    if(!Object.hasOwn(defaults,name))throw new Error('unknown picture tile property');
    if(name==='algn'||name==='flip') {
      if(!(name==='algn'?['tl','t','tr','l','ctr','r','bl','b','br']:['none','x','y','xy']).includes(raw))throw new Error('invalid picture tile alignment or flip');
      tile[name]=raw;
    } else {
      const percent=name==='sx'||name==='sy';
      if(!/^[+-]?\d+$/.test(raw)&&!(percent&&/^[+-]?\d+(\.\d+)?%$/.test(raw)))throw new Error('invalid picture tile coordinate');
      const value=raw.endsWith('%')?Number(raw.slice(0,-1))*1000:Number(raw),limit=percent?2147483647:27273042316900;
      if(!Number.isFinite(value)||value>limit||value<(percent?-2147483648:-limit))throw new Error('picture tile coordinate out of range');
      tile[name]=value;
    }
  }
  return tile;
}

// Tiling repeats the visible cropped image, including for negative crop outsets.
// The original physical image dimensions define alignment before that crop.
// Its shape-fill tile patterns ignore flip; retain the parsed flag for export
// instead of applying the spec's reflections and diverging from the native reference ink.
export function pictureTileGeometry(fill,width,height,pixelWidth,pixelHeight) {
  const t=fill.tile,rect=imageCropRect(fill.image.crop,pixelWidth,pixelHeight);
  if(!rect||t.sx<=0||t.sy<=0)return null;
  const w=t.width*t.sx/100000,h=t.height*t.sy/100000;
  const ax=['t','ctr','b'].includes(t.algn) ? .5 : ['tr','r','br'].includes(t.algn)?1:0;
  const ay=['l','ctr','r'].includes(t.algn) ? .5 : ['bl','b','br'].includes(t.algn)?1:0;
  const [dx,dy,dw,dh]=rect.destination;
  return {source:rect.source,x:(width-w)*ax+t.tx+dx*w,y:(height-h)*ay+t.ty+dy*h,width:w*dw,height:h*dh};
}

export function pictureTilePattern(ctx,fill,width,height,bitmap) {
  const tile=pictureTileGeometry(fill,width,height,bitmap.width,bitmap.height);
  if(!tile)return null;
  let [x,y,w,h]=tile.source;
  const m=ctx.getTransform(),sample=vectorEffectSample(bitmap,
    Math.abs(tile.width)*Math.hypot(m.a,m.b)*bitmap.width/w,
    Math.abs(tile.height)*Math.hypot(m.c,m.d)*bitmap.height/h);
  if(sample!==bitmap){
    const sx=sample.width/bitmap.width,sy=sample.height/bitmap.height;
    x*=sx;y*=sy;w*=sx;h*=sy;bitmap=sample;
  }
  let texture=bitmap;
  if(x!==0||y!==0||w!==bitmap.width||h!==bitmap.height) {
    texture=new OffscreenCanvas(Math.max(1,Math.ceil(w)),Math.max(1,Math.ceil(h)));
    texture.getContext('2d').drawImage(bitmap,x,y,w,h,0,0,texture.width,texture.height);
  }
  // A native repeating pattern bounds work by output pixels, including very
  // small tiles. Do not enumerate arbitrarily many rectangles on the CPU.
  const pattern=ctx.createPattern(texture,'repeat');
  pattern.setTransform(new DOMMatrix([tile.width/texture.width,0,0,tile.height/texture.height,tile.x,tile.y]));
  return pattern;
}
