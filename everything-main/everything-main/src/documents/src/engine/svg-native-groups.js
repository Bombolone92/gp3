// Native reference SVG groups use an intrinsic 8x4 coverage grid before group alpha.
// Keep this display-only: the authored SVG and package parts are never replaced.
import { svgGroupCubicContours, svgGroupCoverageCounts } from './svg-group-cubic.js';
import {svgGroupOpacities,svgGroupOpacityByte,svgOpacityFloat} from './svg-group-opacity.js';
const NS = 'http://www.w3.org/2000/svg';
const shapes = new Set(['path','rect','circle','ellipse','line','polyline','polygon']);
const MAX_SAMPLES = 16 * 1024 * 1024;
const MAX_LAYER_PIXELS = 2 * 1024 * 1024;
const MAX_CURVE_WORK = 8 * 1024 * 1024;
// Native layer bounds round to nearest, resolving exact half ties downward.
const roundBound = value => Math.ceil(value-.5);
const roundedBounds = b => ({x:roundBound(b.x)-1,y:roundBound(b.y)-1,
  width:roundBound(b.x+b.width)-roundBound(b.x)+2,height:roundBound(b.y+b.height)-roundBound(b.y)+2});
const coveredSamples = (start,end,origin,samples) => Math.max(0,
  Math.min(samples,Math.ceil((end-origin)*samples))-Math.max(0,Math.ceil((start-origin)*samples)));
const canvas = (w,h) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const bounded = box => {const b=roundedBounds(box);return Object.values(b).every(Number.isFinite)&&b.width>0&&b.height>0&&b.width<=8192&&b.height<=8192&&b.width*b.height<=MAX_SAMPLES/32;};
const reserveLayer = (box,budget) => {
  if(!bounded(box))return false;
  const b=roundedBounds(box);budget.layers+=b.width*b.height;
  return budget.layers<=MAX_LAYER_PIXELS;
};

function pathFor(node) {
  const p=new Path2D(), value=name=>node[name]?.baseVal?.value || 0;
  if(node.localName==='path') return new Path2D(node.getAttribute('d') || '');
  if(node.localName==='rect') {
    const x=value('x'),y=value('y'),w=value('width'),h=value('height');
    const rx=node.hasAttribute('rx')?value('rx'):value('ry'),ry=node.hasAttribute('ry')?value('ry'):value('rx');
    if(w>0&&h>0)p.roundRect(x,y,w,h,[{x:Math.min(rx,w/2),y:Math.min(ry,h/2)}]);
  } else if(node.localName==='circle'||node.localName==='ellipse') {
    const rx=value(node.localName==='circle'?'r':'rx'),ry=value(node.localName==='circle'?'r':'ry');
    if(rx>0&&ry>0)p.ellipse(value('cx'),value('cy'),rx,ry,0,0,2*Math.PI);
  } else if(node.localName==='line') {p.moveTo(value('x1'),value('y1'));p.lineTo(value('x2'),value('y2'));}
  else {
    for(let i=0;i<node.points.numberOfItems;i++){const q=node.points.getItem(i);if(i)p.lineTo(q.x,q.y);else p.moveTo(q.x,q.y);}
    if(node.localName==='polygon')p.closePath();
  }
  return p;
}

function describe(node, budget,opacities,paintOpacities) {
  // SVG 1.1 §§9.2–9.4 disable these shapes when a size/radius is zero,
  // including their strokes. Their unused paints cannot disqualify siblings.
  // A zero-length line is different: round/square caps can still paint.
  if(node.localName==='rect'&&(node.width.baseVal.value===0||node.height.baseVal.value===0)
    ||node.localName==='circle'&&node.r.baseVal.value===0
    ||node.localName==='ellipse'&&(node.rx.baseVal.value===0||node.ry.baseVal.value===0))return {empty:true};
  const s=getComputedStyle(node);
  if(s.display==='none'||(node.localName==='g'?opacities.get(node):Number(s.opacity))===0)return {empty:true};
  // Retain the existing vector path for paint/clip combinations without native
  // group evidence. In particular, do not flatten strokes or gradient colors.
  if(s.clipPath!=='none'||s.maskImage!=='none'||s.filter!=='none'||s.visibility!=='visible')return null;
  const m=node.getCTM();
  if(!m||m.b!==0||m.c!==0||m.a<=0||m.d<=0)return null;
  if(node.localName==='g') {
    const children=[];
    for(const child of node.children) {
      if(['defs','style','title','desc'].includes(child.localName))continue;
      const description=describe(child,budget,opacities,paintOpacities);if(!description)return null;
      if(!description.empty)children.push(description);
    }
    if(!children.length)return {empty:true};
    const left=Math.min(...children.map(c=>c.box.x)),top=Math.min(...children.map(c=>c.box.y));
    const right=Math.max(...children.map(c=>c.box.x+c.box.width)),bottom=Math.max(...children.map(c=>c.box.y+c.box.height));
    const box={x:left,y:top,width:right-left,height:bottom-top};
    return reserveLayer(box,budget)?{children,opacity:opacities.get(node),box}:null;
  }
  if(!shapes.has(node.localName)||s.stroke!=='none')return null;
  if(s.fill==='none')return {empty:true};
  const color=/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(s.fill);
  if(!color)return null;
  const opacity=paintOpacities.get(node)*svgOpacityFloat(Number(color[4]??1));
  if(!opacity)return {empty:true};
  const b=node.getBBox(),box={x:m.a*b.x+m.e,y:m.d*b.y+m.f,width:m.a*b.width,height:m.d*b.height};
  if(!box.width||!box.height)return {empty:true};
  if(!reserveLayer(box,budget))return null;
  const bounds=roundedBounds(box);
  budget.samples+=bounds.width*bounds.height*32;
  if(budget.samples>MAX_SAMPLES)return null;
  // Native controls establish cubic subdivision in intrinsic coordinates.
  // Other mappings keep the existing coverage path, as do excessive scans.
  let contours=null;
  if(node.localName==='path'&&m.a===1&&m.d===1&&Number.isInteger(m.e)&&Number.isInteger(m.f)&&budget.curveWork<MAX_CURVE_WORK) {
    const candidate=svgGroupCubicContours(node.getAttribute('d')||'');
    if(candidate) {
      const cost=bounds.height*candidate.reduce((n,p)=>n+p.length,0)*4;
      if(budget.curveWork+cost<=MAX_CURVE_WORK) {
        contours=candidate.map(points=>points.map(([x,y])=>[x+m.e,y+m.f]));
        budget.curveWork+=cost;
      }
    }
  }
  const path=new Path2D();path.addPath(pathFor(node),m);
  const rectangle=node.localName==='rect'&&!node.rx.baseVal.value&&!node.ry.baseVal.value;
  return {box,path,rectangle,contours,rule:s.fillRule,color:color.slice(1,4).map(Number),
    opacity};
}

function render(description) {
  const b=roundedBounds(description.box),out=canvas(b.width,b.height),ctx=out.getContext('2d');
  const result=ctx.createImageData(b.width,b.height);
  // The native reference stores straight RGBA between paints. Browser drawImage source-over
  // retains premultiplied channels and produces different overlap colors.
  function over(pixels,at,red,green,blue,alpha,premultiplied=false) {
    if(!alpha)return;
    const old=pixels[at+3],remaining=(255-alpha)/255;
    const next=alpha+Math.round(old*remaining),inverse=Math.floor(255*65536/next);
    for(let k=0;k<3;k++) {
      const channel=k===0?red:k===1?green:blue;
      const source=premultiplied?channel:Math.round(channel*alpha/255);
      const destination=Math.round(pixels[at+k]*old/255);
      pixels[at+k]=Math.floor((source+Math.round(destination*remaining))*inverse/65536);
    }
    pixels[at+3]=next;
  }
  function paint(d,pixels,frame=b) {
    if(d.children) {
      if(d.opacity===1){for(const child of d.children)paint(child,pixels,frame);return;}
      const box=roundedBounds(d.box),layer=new Uint8ClampedArray(box.width*box.height*4);
      // Group image opacity is rounded to a byte; paint opacity is truncated.
      // Keep each group isolated instead of multiplying nested declarations.
      const opacity=svgGroupOpacityByte(d.opacity)/255;
      for(const child of d.children)paint(child,layer,box);
      for(let y=0;y<box.height;y++)for(let x=0;x<box.width;x++) {
        const at=(y*box.width+x)*4,target=((box.y-frame.y+y)*frame.width+box.x-frame.x+x)*4;
        const alpha=Math.round(layer[at+3]*opacity);
        if(!alpha)continue;
        if(!pixels[target+3]) {
          pixels[target]=layer[at];pixels[target+1]=layer[at+1];pixels[target+2]=layer[at+2];pixels[target+3]=alpha;
        } else over(pixels,target,layer[at],layer[at+1],layer[at+2],alpha);
      }
      return;
    }
    const bounds=roundedBounds(d.box),brushAlpha=Math.floor(d.opacity*255);
    if(!brushAlpha)return;
    const channels=d.color.map(c=>Math.round(c*brushAlpha/255));
    const counts=d.contours?svgGroupCoverageCounts(d.contours,bounds,d.rule):null;
    const mask=d.rectangle||counts?null:canvas(bounds.width*8,bounds.height*4),mc=mask?.getContext('2d');
    // Half a sample pixel aligns pixel centers with the native integer-origin
    // grid: x + k/8, y + j/4. Thresholding recovers binary sample coverage.
    if(mc){mc.setTransform(8,0,0,4,-bounds.x*8+.5,-bounds.y*4+.5);mc.fill(d.path,d.rule);}
    const raw=mc?.getImageData(0,0,mask.width,mask.height).data;
    for(let y=0;y<bounds.height;y++)for(let x=0;x<bounds.width;x++) {
      let count=0;
      if(counts) count=counts[y*bounds.width+x];
      else if(d.rectangle) {
        // Native rectangles include top/left but exclude bottom/right;
        // isPointInPath includes every boundary and adds an edge sample.
        const box=d.box;
        count=coveredSamples(box.x,box.x+box.width,bounds.x+x,8)*coveredSamples(box.y,box.y+box.height,bounds.y+y,4);
      } else for(let j=0;j<4;j++)for(let i=0;i<8;i++) {
        const alpha=raw[((y*4+j)*mask.width+x*8+i)*4+3];
        // Canvas can quantize a rounded rectangle's edge before coverage.
        // Resolve only partial mask pixels against the actual sample center.
        count+=alpha===255||alpha!==0&&mc.isPointInPath(d.path,x*8+i+.5,y*4+j+.5,d.rule);
      }
      if(!count)continue;
      const at=((bounds.y-frame.y+y)*frame.width+bounds.x-frame.x+x)*4;
      over(pixels,at,Math.round(channels[0]*count/32),Math.round(channels[1]*count/32),
        Math.round(channels[2]*count/32),Math.round(count*brushAlpha/32),true);
    }
    if(mask)mask.width=mask.height=0;
  }
  paint(description,result.data);ctx.putImageData(result,0,0);
  return {canvas:out,x:b.x,y:b.y};
}

export function nativeSvgGroups(root,opacities,paintOpacities) {
  if(!opacities||!paintOpacities){const values=svgGroupOpacities(root,true);opacities=values.opacities;paintOpacities=values.paintOpacities;}
  const handled=new Set(),budget={samples:0,layers:0,curveWork:0};
  for(const node of opacities.keys()) {
    if(node.localName!=='g')continue;
    if(!node.isConnected||node.closest('defs,clipPath,mask,filter')||opacities.get(node)>=1)continue;
    let ancestor=node.parentElement,inside=false;
    while(ancestor&&ancestor!==root){if(handled.has(ancestor)){inside=true;break;}ancestor=ancestor.parentElement;}
    if(inside)continue;
    handled.add(node);
    const before={...budget},description=describe(node,budget,opacities,paintOpacities);
    if(!description||description.empty){Object.assign(budget,before);continue;}
    const matrix=node.getCTM().inverse(),layer=render(description),image=document.createElementNS(NS,'image');
    image.setAttribute('x',String(layer.x));image.setAttribute('y',String(layer.y));
    image.setAttribute('width',String(layer.canvas.width));image.setAttribute('height',String(layer.canvas.height));
    image.setAttribute('href',layer.canvas.toDataURL());image.setAttribute('preserveAspectRatio','none');
    image.setAttribute('style',`all:initial;x:${layer.x}px;y:${layer.y}px;width:${layer.canvas.width}px;height:${layer.canvas.height}px;transform:matrix(${matrix.a},${matrix.b},${matrix.c},${matrix.d},${matrix.e},${matrix.f});transform-origin:0 0`);
    for(const child of [...node.children])if(!['defs','style','title','desc'].includes(child.localName))child.remove();
    node.style.opacity='1';node.append(image);layer.canvas.width=layer.canvas.height=0;
  }
}
