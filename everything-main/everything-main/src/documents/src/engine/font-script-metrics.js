// Read only the square-pixel device group used by the native 600 DPI controls.
// Missing entries use scaled Windows metrics; malformed tables retain fallback.
function symbolCmap(view,table){
 if(!table||table.length<4||view.getUint16(table.offset)!==0)return false;
 const count=view.getUint16(table.offset+2);if(4+count*8>table.length)return false;
 let symbol=false,unicode=false;
 for(let i=0;i<count;i++){
  const at=table.offset+4+i*8;
  if(view.getUint16(at)===3){const encoding=view.getUint16(at+2);symbol ||= encoding===0;unicode ||= encoding===1||encoding===10;}
 }
 return symbol&&!unicode;
}

function squareDeviceBounds(view,table,cmap){
 if(!table)return {};
 const v=new DataView(view.buffer,view.byteOffset+table.offset,table.length);
 if(v.byteLength<6||v.getUint16(0)>1||!v.getUint16(2))return null;
 const ratios=v.getUint16(4),header=6+ratios*6;
 if(!ratios||header>v.byteLength)return null;
 let selected=null;
 for(let i=0;i<ratios;i++){
  const at=6+4*i,charSet=v.getUint8(at),x=v.getUint8(at+1),lo=v.getUint8(at+2),hi=v.getUint8(at+3);
  const offset=v.getUint16(6+4*ratios+2*i);
  if(offset<header||offset+4>v.byteLength||charSet>1||lo>hi||(!x&&(lo||hi)))return null;
  // Charset 1 is the native ANSI/full-set group. Version 1 charset 0 also
  // describes the full glyph set; version 0 charset 0 is symbol-specific.
  const matches=(charSet===1||charSet===0&&(v.getUint16(0)===1||symbolCmap(view,cmap)))&&(!x||lo<=x&&x<=hi);
  if(matches&&selected===null)selected=offset;
 }
 if(selected===null)return {};
 const count=v.getUint16(selected),start=v.getUint8(selected+2),end=v.getUint8(selected+3);
 if(start>end||selected+4+count*6>v.byteLength)return null;
 const bounds={};let previous=-1;
 for(let i=0;i<count;i++){
  const at=selected+4+6*i,p=v.getUint16(at),a=v.getInt16(at+2),d=-v.getInt16(at+4);
  if(p<=previous||p<start||(end<255&&p>end)||a<0||d<0)return null;
  bounds[p]=[a,d];previous=p;
 }
 return bounds;
}

export function readScriptPositionMetrics(view,tables){
 try{
  const os2=tables.get('OS/2'),hhea=tables.get('hhea');
  if(os2.length<78||!hhea||hhea.length<36||view.getUint32(hhea.offset)!==0x10000)return null;
  const ascent=view.getUint16(os2.offset+74),descent=view.getUint16(os2.offset+76);
  if(!ascent)return null;
  const externalLeading=Math.max(0,view.getInt16(hhea.offset+4)-view.getInt16(hhea.offset+6)+view.getInt16(hhea.offset+8)-ascent-descent);
  const deviceBounds=squareDeviceBounds(view,tables.get('VDMX'),tables.get('cmap'));
  return deviceBounds===null?null:{ascent,descent,externalLeading,deviceBounds};
 }catch{return null;}
}

const quantize=device=>Math.round(device*.24)/2;
export function scriptPosition(size,reduced,script,metadata){
 const m=metadata?.scriptPositionMetrics,em=metadata?.unitsPerEm,offsets=metadata?.scriptMetrics;
 if(!m||!offsets||!(em>0)||!(size>0)||!Number.isFinite(size)||!(reduced>0&&reduced<size)||
    script!=='subscript'&&script!=='superscript'||
    metadata.variable&&!metadata.scriptPositionInvariant||offsets[3]<0||offsets[7]<0)return null;
 const sub=script==='subscript',sample=sub?reduced:Math.min(reduced,Math.round(size*4/3)/2);
 const full=Math.round(size/.12),small=Math.round(sample/.12);
 const metrics=p=>{
  const a=Math.round(p*m.ascent/em),d=Math.round(p*m.descent/em);
  const bounds=m.deviceBounds[p]||[a,d];
  return {ascent:bounds[0],descent:bounds[1],unhintedAscent:a,unhintedDescent:d,leading:Math.round(p*m.externalLeading/em)};
 };
 const a=metrics(full),b=metrics(small);
 const fallback=Math.round(2*size*offsets[7]/em)<Math.floor(size/2)||Math.round(2*size*offsets[3]/em)>Math.floor(size);
 const cap=Math.round(2*size*(fallback?(sub?.2:.4):offsets[sub?3:7]/em))/2;
 const gap=sub?
  Math.min(quantize(a.descent),Math.max(quantize(a.unhintedDescent),Math.round(size)/2))-
  Math.min(quantize(b.descent),Math.max(quantize(b.unhintedDescent),Math.round(sample)/2)):
  Math.min(quantize(a.ascent+a.leading),Math.max(quantize(a.unhintedAscent+a.leading),size))-
  Math.min(quantize(b.ascent),Math.max(quantize(b.unhintedAscent),sample));
 return Math.max(0,Math.min(gap,cap))*(sub?1:-1);
}
