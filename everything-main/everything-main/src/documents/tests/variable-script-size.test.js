import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {readFontMetadata} from '../src/engine/font-metadata.js';
import {reducedScriptSize} from '../src/engine/script-font-size.js';

const reference=JSON.parse(readFileSync('tests/fixtures/bundled-script/origin-reference.json'));
const font=name=>{const b=readFileSync('public/fonts/'+name);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
for(const face of reference.cases)it(`matches native variable-font sizes for ${face.face}`,()=>{
 const metadata=readFontMetadata(font(face.font));
 expect(metadata).toMatchObject({variable:true,scriptSizeInvariant:true});
 for(const row of face.rows)expect(Math.abs(reducedScriptSize(row.size,row.script,metadata)-row.nativeSizePt)).toBeLessThan(.061);
});

function altered(change){
 const buffer=font('NotoSans.ttf'),view=new DataView(buffer);
 for(let i=0;i<view.getUint16(4);i++){
  const p=12+16*i;
  if(view.getUint32(p)===0x4d564152){change(view,view.getUint32(p+8),p);return readFontMetadata(buffer);}
 }
 throw new Error('Expected MVAR');
}
it.each(['sbys','sbyo','spys','spyo'])('does not reuse default-instance values when %s varies',tag=>{
 const metadata=altered((v,p)=>{[...tag].forEach((c,i)=>v.setUint8(p+12+i,c.charCodeAt(0)));});
 expect(metadata.scriptSizeInvariant).toBe(false);
 expect(reducedScriptSize(12,'superscript',metadata)).toBeNull();
});
it('retains constant script metrics when MVAR is absent',()=>{
 const metadata=altered((v,p,d)=>v.setUint32(d,0x54455354));
 expect(metadata.scriptSizeInvariant).toBe(true);
 expect(reducedScriptSize(12,'superscript',metadata)).toBe(7);
});
it.each([1,8,12])('accepts a valid empty MVAR directory with record size %i',size=>{
 const metadata=altered((v,p)=>{v.setUint16(p+6,size);v.setUint16(p+8,0);v.setUint16(p+10,0);});
 expect(metadata.scriptSizeInvariant).toBe(true);
 expect(reducedScriptSize(12,'superscript',metadata)).toBe(7);
});
it.each([
 (v,p)=>v.setUint32(p,0x20000),
 (v,p)=>v.setUint16(p+4,1),
 (v,p)=>v.setUint16(p+6,4),
 (v,p)=>v.setUint16(p+8,65535),
 (v,p)=>v.setUint16(p+10,0),
 (v,p)=>v.setUint16(p+10,65535),
 (v,p)=>v.setUint32(p+20,v.getUint32(p+12)),
 (v,p,d)=>v.setUint32(d+12,10),
])('keeps uncertain or malformed variation metadata on the fallback path',change=>{
 const metadata=altered(change);expect(metadata.scriptSizeInvariant).toBe(false);
 expect(reducedScriptSize(12,'superscript',metadata)).toBeNull();
});
