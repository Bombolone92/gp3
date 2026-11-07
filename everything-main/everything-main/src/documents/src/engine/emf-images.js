import { emfFont, emfText, emfFontFamilies } from './emf-text.js';
import { prepareMetafileFonts } from './metafile-reviewed-fonts.js';
import { vectorImage } from './vector-image-effects.js';
import { emfDualComment } from './emf-dual.js';
// Original vector-only EMF playback, from MS-EMF record definitions. Numeric
// drawing output only; unsupported operations fail before editable DOCX import.
export const EMF_MIME = 'image/emf';
const fail = message => { throw new Error(`Unsupported EMF: ${message}.`); };
export function isEmf(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44) return false;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return v.getUint32(0, true) === 1 && v.getUint32(40, true) === 0x464d4520;
}
const color = n => '#' + [n & 255, n >>> 8 & 255, n >>> 16 & 255].map(v => v.toString(16).padStart(2, '0')).join('');
const identity = [1,0,0,1,0,0];
const mul = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
const apply = (m,x,y) => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
function inverse(m) {
  const d=m[0]*m[3]-m[1]*m[2]; if (!Number.isFinite(d) || Math.abs(d)<1e-12) fail('singular coordinate transform');
  return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];
}
function parse(bytes, pixelEffects, inspectText) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 8*1024*1024 || !isEmf(bytes) || bytes.length<88) fail('invalid header');
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), read=i=>header.getInt32(i,true);
  const dx=read(72),dy=read(76),mmx=read(80),mmy=read(84);
  if (![dx,dy,mmx,mmy].every(n=>n>0&&n<1e9)) fail('invalid reference device');
  // The physical frame, not the tighter ink bounds, establishes the viewport.
  // GDI includes the final device pixel after converting hundredths of mm.
  const left=read(24)*dx/mmx/100,top=read(28)*dy/mmy/100;
  const width=(read(32)-read(24))*dx/mmx/100+1,height=(read(36)-read(28))*dy/mmy/100+1;
  if (!(width>0&&height>0&&width<=8192&&height<=8192&&width*height<=16000000)) fail('invalid or excessive frame');
  const length=header.getUint32(48,true),expected=header.getUint32(52,true),handles=header.getUint16(56,true);
  // Each record consumes at least its eight-byte header. Bound the declared
  // count by the already bounded input, rather than rejecting detailed artwork.
  if(header.getUint32(44,true)!==0x10000 || length!==bytes.length || expected<3 || expected>Math.floor(length/8) || !handles) fail('invalid record table');
  let state={window:[0,0,1,1],viewport:[0,0,1,1],world:identity,mode:1,current:[0,0],pen:{color:'#000000',width:1,style:0},brush:'#ffffff',fill:'evenodd',clips:[],miter:10,miterBits:0,textColor:'#000000',textAlign:0,backgroundMode:2,font:null};
  const objects=new Map(),stack=[],defs=[],paint=[],textFonts=new Map();
  const dual={started:false,ended:false};
  const textMiterPaths=[];let hasTextRecord=false;
  let path=null,cursor=null,building=false,count=0,points=0,eof=false;
  const matrix=()=> {
    const w=state.window,v=state.viewport,sx=state.mode===1?1:v[2]/w[2],sy=state.mode===1?1:v[3]/w[3];
    const m=mul([sx,0,0,sy,v[0]-w[0]*sx,v[1]-w[1]*sy],state.world);inverse(m);return m;
  };
  const command=(op,values=[])=>{
    if(++points>250000)fail('geometry limit');
    const m=matrix(),p=[op];for(let i=0;i<values.length;i+=2)p.push(...apply(m,values[i],values[i+1]));path.push(p);cursor=op==='Z'?null:p.slice(-2);
  };
  const start=()=>{const p=apply(matrix(),...state.current);if(!path.length||!cursor)command('M',state.current);else if(p.some((v,i)=>Math.abs(v-cursor[i])>1e-8))command('L',state.current);};
  const data=(commands,transform=identity)=>commands.map(([op,...v])=>op+v.reduce((a,_,i)=>i%2?a:[...a,...apply(transform,v[i],v[i+1])],[]).map(n=>{if(!Number.isFinite(n)||Math.abs(n)>1e9)fail('invalid coordinates');return Number(n.toFixed(6));}).join(' ')).join(' ');
  const wrapped=node=>state.clips.reduce((n,id)=>`<g clip-path="url(#${id})">${n}</g>`,node);
  const draw=(fill,stroke)=>{
    if(!path || building)fail('missing completed path');
    // StrokeAndFillPath closes open figures before both operations.
    if (fill && stroke) {
      const closed=[];let open=false;
      for(const c of path){if(c[0]==='M'&&open)closed.push(['Z']);closed.push(c);if(c[0]==='M')open=true;else if(c[0]==='Z')open=false;}
      if(open)closed.push(['Z']);path=closed;
    }
    let attrs=`fill="${fill?state.brush:'none'}" fill-rule="${state.fill}"`,m=identity;
    if(stroke && state.pen.color!=='none'){
      const p=state.pen,geometric=!!(p.style&0x10000);m=geometric?matrix():identity;
      attrs+=` stroke="${p.color}" stroke-width="${p.width||1}" stroke-linecap="${['round','square','butt'][(p.style>>>8)&15]}" stroke-linejoin="${['round','bevel','miter'][(p.style>>>12)&15]}" stroke-miterlimit="${state.miter}"`;
      if(pixelEffects&&state.miterBits>1&&state.miterBits<=100000)textMiterPaths.push({index:paint.length,bits:state.miterBits,float:state.miter});
    }
    paint.push(wrapped(`<path d="${data(path,inverse(m))}" transform="matrix(${m.join(' ')})" ${attrs}/>`));path=null;
  };
  const clip=mode=>{
    if(!path||building||![1,5].includes(mode))fail('unsupported clipping combination');
    const id='c'+defs.length;defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${data(path)}" clip-rule="${state.fill}"/></clipPath>`);
    state.clips=mode===5?[id]:[...state.clips,id];if(state.clips.length>64)fail('clipping depth');path=null;
  };
  const pen=(style,width,brush,col)=>{
    if(![0,5].includes(style&15) || style&~0x1330f || ((style>>>8)&15)>2 || ((style>>>12)&15)>2 || ![0,1].includes(brush))fail('unsupported pen style');
    if(!(style&0x10000)&&width>1)fail('wide cosmetic pen');
    return {type:'pen',style,width,color:(style&15)===5||brush===1?'none':color(col)};
  };
  for(let pos=0;pos<length;){
    if(pos+8>length||++count>expected)fail('truncated records');
    const type=header.getUint32(pos,true),size=header.getUint32(pos+4,true);
    if(size<8||size%4||pos+size>length)fail('invalid record length');
    const v=new DataView(bytes.buffer,bytes.byteOffset+pos,size),u=i=>v.getUint32(i,true),s=i=>v.getInt32(i,true),f=i=>v.getFloat32(i,true);
    const put=(id,value)=>{if(!id||id>=handles||objects.has(id))fail('invalid object handle');objects.set(id,value);};
    if(type===1){if(pos||size<88)fail('invalid header record');}
    else if(type===14){if(size<20||pos+size!==length)fail('invalid end record');eof=true;}
    else if([9,10,11,12].includes(type)){
      const key=type<11?'window':'viewport',at=type===9||type===11?2:0;
      if(at===2 && (!s(8)||!s(12)))fail('empty mapping extent');
      state[key]=[...state[key]];state[key][at]=s(8);state[key][at+1]=s(12);
    } else if(type===17){if(![1,8].includes(s(8)))fail('mapping mode');state.mode=s(8);}
    else if(type===19){if(![1,2].includes(u(8)))fail('fill mode');state.fill=u(8)===1?'evenodd':'nonzero';}
    else if(type===20){if(u(8)!==13)fail('raster operation');}
    else if(type===18){if(![1,2].includes(u(8)))fail('text background mode');state.backgroundMode=u(8);}
    else if(type===22)state.textAlign=u(8);
    else if(type===24)state.textColor=color(u(8));
    else if(type===82)put(u(8),emfFont(v));
    else if(type===84){
      if(building)fail('text inside path');
      const m=matrix();let text=emfText(v,state,m);hasTextRecord=true;
      if(text){const families=emfFontFamilies(state.font);textFonts.set(JSON.stringify(families),families);}
      if(u(52)&4){
        const l=s(56),t=s(60),r=s(64),b=s(68),id='c'+defs.length;
        if(r<l||b<t)fail('inverted text clipping rectangle');
        defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><path d="${data([['M',l,t],['L',r,t],['L',r,b],['L',l,b],['Z']],m)}"/></clipPath>`);
        text=`<g clip-path="url(#${id})">${text}</g>`;
      }
      paint.push(wrapped(text));
    }
    else if([13,21,25].includes(type)){u(8);if(type===13)u(12); /* Nonpainting state for this vector-only subset. */}
    else if(type===33){if(stack.length>=64)fail('saved state depth');stack.push(structuredClone(state));}
    else if(type===34){const n=s(8),at=n<0?stack.length+n:n-1;if(at<0||at>=stack.length)fail('invalid restored state');state=stack[at];stack.length=at;}
    else if(type===35||type===36){const m=Array.from({length:6},(_,i)=>f(8+4*i));if(m.some(n=>!Number.isFinite(n)))fail('invalid world transform');const mode=type===35?4:u(32);if(![1,2,3,4].includes(mode))fail('world transform mode');state.world=mode===1?identity:mode===4?m:mode===2?mul(state.world,m):mul(m,state.world);}
    else if(type===38)put(u(8),pen(u(12),u(16),0,u(24)));
    else if(type===39){if(![0,1].includes(u(12)))fail('pattern brush');put(u(8),{type:'brush',color:u(12)===1?'none':color(u(16))});}
    else if(type===95){if(u(16)||u(24)||u(48))fail('pattern or custom pen');put(u(8),pen(u(28),u(32),u(36),u(40)));}
    else if(type===37){
      const id=u(8),stock=id>>>31,kind=id&0x7fffffff;
      const object=stock?(kind<=5?{type:'brush',color:['#ffffff','#c0c0c0','#808080','#404040','#000000','none'][kind]}:kind<=8?pen(kind===8?5:0,1,0,kind===6?0xffffff:0):[10,11,12,13,14,16,17].includes(kind)?{type:'font',stock:true}:null):objects.get(id);
      if(!object)fail('unsupported selected object');if(object.type==='pen')state.pen=object;else if(object.type==='font')state.font=object;else state.brush=object.color;
    } else if(type===40){if(!objects.delete(u(8)))fail('missing deleted object');}
    // Preserve both encodings: text-bearing picture-effect playback
    // uses the main clause's bounded UINT32 values; ordinary vector playback
    // follows note 90's FLOAT encoding. Text may occur after affected paths.
    else if(type===58){const n=f(8);if(!(n>=0&&n<=100000))fail('miter limit');state.miter=Math.max(1,n);state.miterBits=u(8);}
    else if(type===59){if(building)fail('nested path');path=[];building=true;}
    else if(type===60){if(!building)fail('path end without begin');building=false;}
    else if(type===61){if(!building)fail('close outside path');command('Z');}
    else if(type===68){path=null;building=false;}
    else if(type===27){state.current=[s(8),s(12)];if(building)command('M',state.current);}
    else if(type===54){const immediate=!building;if(immediate)path=[];start();state.current=[s(8),s(12)];command('L',state.current);if(immediate)draw(false,true);}
    else if([2,3,4,5,6,85,86,87,88,89].includes(type)){
      const small=type>=85,base=small?type-83:type,n=u(24),stride=small?4:8;
      if(n>100000||28+n*stride>size)fail('invalid point array');
      const ps=Array.from({length:n},(_,i)=>small?[v.getInt16(28+i*4,true),v.getInt16(30+i*4,true)]:[s(28+i*8),s(32+i*8)]);
      const immediate=!building;if(immediate)path=[];
      const to=base===5||base===6,bezier=base===2||base===5;
      if(!n || bezier && !to && n<4 || bezier && (n-(to?0:1))%3)fail('invalid path points');
      if(to){start();}else command('M',ps.shift());
      for(let i=0;i<ps.length;i+=bezier?3:1)command(bezier?'C':'L',bezier?ps.slice(i,i+3).flat():ps[i]);
      if(base===3)command('Z');if(to)state.current=ps.at(-1);
      if(immediate)draw(base===3,true);
    } else if(type===62||type===63||type===64){if(size<24)fail('missing path bounds');draw(type!==64,type!==62);}
    else if(type===67)clip(u(8));
    else if(type===75){if(u(8)!==0||u(12)!==5)fail('region clipping');state.clips=[];}
    else if(type===70){const n=u(8);if(n>size-12)fail('invalid comment');if(n>=4&&u(12)===0x2b464d45)emfDualComment(v,n,dual,count); /* Other private comments do not replace standard playback. */}
    else fail(`record ${type}`);
    pos+=size;
  }
  if(!eof||count!==expected||building||!paint.length||dual.started&&!dual.ended)fail('incomplete drawing');
  if(pixelEffects&&hasTextRecord)for(const p of textMiterPaths)paint[p.index]=paint[p.index].replace(` stroke-miterlimit="${p.float}"`,` stroke-miterlimit="${p.bits}"`);
  // Pixel effects use the physical frame. Its inclusive final pixel belongs
  // to the output raster device, rather than scaling with reference-device
  // coordinates (independent native range controls at four sizes/three frames).
  // Retain the existing source viewport so strokes extending past the physical
  // frame survive until the output canvas clips them. Shrinking the SVG itself
  // would prematurely remove ink from the final output pixel.
  const rasterFrame=pixelEffects && width>1 && height>1 ? {width:width/(width-1),height:height/(height-1)} : null;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(width)}" height="${Math.ceil(height)}" preserveAspectRatio="none" viewBox="${left} ${top} ${width} ${height}"><defs>${defs.join('')}</defs>${paint.join('')}</svg>`;
  if(svg.length>16*1024*1024)fail('drawing output limit');
  return {mime:EMF_MIME,width:Math.ceil(width),height:Math.ceil(height),svg,textFonts:[...textFonts.values()],...(pixelEffects?{rasterFrame}:{}),...(inspectText?{hasTextRecord}:{})};
}
export function emfInfo(bytes, { pixelEffects = false, inspectText = false } = {}) {
  try {return parse(bytes, pixelEffects, inspectText);} catch(error){if(error instanceof RangeError)fail('truncated record fields');throw error;}
}
export async function decodeEmf(bytes, onMissingFont, pixelEffects = false) {
  const {svg,textFonts,rasterFrame}=emfInfo(bytes, {pixelEffects});
  const { svg: rendered, missing } = await prepareMetafileFonts(svg, textFonts);
  if(onMissingFont) for(const family of missing) onMissingFont(family);
  const url=URL.createObjectURL(new Blob([rendered],{type:'image/svg+xml'})),image=new Image();
  try {image.src=url;await image.decode();image.close=()=>{image.removeAttribute('src');URL.revokeObjectURL(url);};return vectorImage(image, {rasterFrame});}
  catch(error){URL.revokeObjectURL(url);throw error;}
}
