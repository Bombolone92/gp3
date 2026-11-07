import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {scriptPosition} from '../src/engine/font-script-metrics.js';
const buffer=file=>{const b=readFileSync(file);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
function changed(file,tag,change){
 const b=buffer(file),v=new DataView(b);
 for(let i=0;i<v.getUint16(4);i++){const p=12+16*i;if(String.fromCharCode(...new Uint8Array(b,p,4))===tag){change(v,v.getUint32(p+8),p);return readFontMetadata(b);}}
 throw new Error('Missing control table');
}
const vdmx='tests/fixtures/script-vdmx-ppem/ScriptSizeProbe83.ttf';
it('uses the correct normalized square-pixel ratio and preserves sparse entries',()=>{
 const m=readFontMetadata(buffer(vdmx));expect(m.scriptPositionMetrics.deviceBounds[83]).toEqual([83,30]);
 const ratio=changed(vdmx,'VDMX',(v,p)=>{v.setUint8(p+7,2);v.setUint8(p+8,1);v.setUint8(p+9,2);});
 expect(ratio.scriptPositionMetrics).toEqual(m.scriptPositionMetrics);
 const sparse=changed(vdmx,'VDMX',(v,p)=>{v.setUint16(p+12,2);v.setUint8(p+15,2);});
 expect(Object.keys(sparse.scriptPositionMetrics.deviceBounds)).toEqual(['1','2']);
});
it('uses linear metrics when a valid VDMX table has no device ratio match',()=>{
 const m=changed(vdmx,'VDMX',(v,p)=>{v.setUint8(p+7,2);v.setUint8(p+8,1);v.setUint8(p+9,1);});
 expect(m.scriptPositionMetrics.deviceBounds).toEqual({});
});
it('distinguishes version-zero symbol groups from ANSI fonts',()=>{
 const ansi=changed(vdmx,'VDMX',(v,p)=>{v.setUint16(p,0);v.setUint8(p+6,0);});
 expect(ansi.scriptPositionMetrics.deviceBounds).toEqual({});
 const b=buffer(vdmx),v=new DataView(b);
 for(let i=0;i<v.getUint16(4);i++){
  const at=12+16*i,tag=String.fromCharCode(...new Uint8Array(b,at,4)),p=v.getUint32(at+8);
  if(tag==='VDMX'){v.setUint16(p,0);v.setUint8(p+6,0);}
  if(tag==='cmap')for(let j=0;j<v.getUint16(p+2);j++){
   const record=p+4+j*8;if(v.getUint16(record)===3)v.setUint16(record+2,0);
  }
 }
 expect(readFontMetadata(b).scriptPositionMetrics.deviceBounds[83]).toEqual([83,30]);
 const full=changed(vdmx,'VDMX',(v,p)=>{v.setUint16(p,1);v.setUint8(p+6,0);});
 expect(full.scriptPositionMetrics.deviceBounds[83]).toEqual([83,30]);
});
it.each([
 (v,p)=>v.setUint16(p,2),(v,p)=>v.setUint16(p+2,0),(v,p)=>v.setUint16(p+4,65535),
 (v,p)=>v.setUint16(p+10,6),(v,p)=>v.setUint16(p+12,65535),
 (v,p)=>v.setUint8(p+8,1),(v,p)=>v.setUint16(p+22,1),
 (v,p)=>v.setInt16(p+18,-1),(v,p)=>v.setInt16(p+20,1),
])('retains position fallback for malformed VDMX data',change=>{
 const m=changed(vdmx,'VDMX',change);expect(m).not.toBeNull();expect(m.scriptPositionMetrics).toBeUndefined();
 expect(scriptPosition(10,6,'superscript',m)).toBeNull();
});
it.each(['hasc','hdsc','hlgp','hcla','hcld','sbys','sbyo','spys','spyo'])('does not assume a fixed position when %s varies',tag=>{
 const m=changed('public/fonts/NotoSans.ttf','MVAR',(v,p)=>{[...tag].forEach((c,i)=>v.setUint8(p+12+i,c.charCodeAt(0)));});
 expect(m.scriptPositionInvariant).toBe(false);expect(scriptPosition(12,7,'superscript',m)).toBeNull();
});
