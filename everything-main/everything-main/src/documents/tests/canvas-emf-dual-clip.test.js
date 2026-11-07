import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {emfInfo} from '../src/engine/emf-images.js';
const parts=unzipSync(readFileSync('tests/fixtures/emf-dual-clip/control.docx'));
const media=i=>parts[`word/media/control${i}.emf`];
function offsets(bytes,type){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=[];for(let at=0;at<bytes.length;at+=v.getUint32(at+4,true))if(v.getUint32(at,true)===type)out.push(at);return out;}
it('plays the complete standard EMF representation of a Dual stream exactly once',()=>{
 const plain=emfInfo(media(1)),dual=emfInfo(media(2));expect(dual).toEqual(plain);
 expect(dual.svg.match(/<text /g)).toHaveLength(2);
});
it('clips only the selected text record in transformed logical coordinates',()=>{
 const svg=emfInfo(media(5)).svg;
 const coordinates=svg.match(/<path d="([^"]+)"/)[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
 [18.2,0,56,0,56,90,18.2,90].forEach((n,i)=>expect(coordinates[i]).toBeCloseTo(n,5));
 expect(svg.match(/<g clip-path=/g)).toHaveLength(1);
 expect(svg.match(/<text /g)).toHaveLength(2);
});
it('preserves empty and outside clips without dropping the following text',()=>{
 for(const i of [6,7]){const svg=emfInfo(media(i)).svg;expect(svg.match(/<text /g)).toHaveLength(2);expect(svg.match(/<clipPath /g)).toHaveLength(1);}
});
it('allows an unsupported font selected after the final drawing, but rejects drawing with it',()=>{
 expect(emfInfo(media(0)).svg.match(/<text /g)).toHaveLength(2);
 const original=media(0),textAt=offsets(original,84)[0],fontAt=offsets(original,82).at(-1);
 const view=new DataView(original.buffer,original.byteOffset,original.byteLength),size=view.getUint32(textAt+4,true);
 const insert=fontAt+view.getUint32(fontAt+4,true)+12;
 const bytes=new Uint8Array(original.length+size);bytes.set(original.subarray(0,insert));bytes.set(original.subarray(textAt,textAt+size),insert);bytes.set(original.subarray(insert),insert+size);
 const v=new DataView(bytes.buffer);v.setUint32(48,bytes.length,true);v.setUint32(52,v.getUint32(52,true)+1,true);
 expect(()=>emfInfo(bytes)).toThrow(/font dimensions or rotation/);
});
it.each([
 ['Only stream',(v,c)=>v.setUint16(c[0]+18,0,true)],
 ['missing header',(v,c)=>v.setUint16(c[0]+16,0x4004,true)],
 ['truncated plus header',(v,c)=>v.setUint32(c[0]+8,8,true)],
 ['zero record length',(v,c)=>v.setUint32(c[0]+20,0,true)],
 ['oversized payload',(v,c)=>v.setUint32(c[0]+24,1000,true)],
 ['duplicate header',(v,c)=>v.setUint16(c[0]+44,0x4001,true)],
 ['missing end',(v,c)=>v.setUint16(c[1]+16,0x4004,true)],
 ['invalid end',(v,c)=>v.setUint32(c[1]+24,4,true)],
 ['empty comment',(v,c)=>v.setUint32(c[0]+8,4,true)],
])('rejects %s without silently dropping alternate artwork',(_,change)=>{
 const bytes=media(0).slice(),v=new DataView(bytes.buffer);change(v,offsets(bytes,70));expect(()=>emfInfo(bytes)).toThrow(/Unsupported EMF/);
});
it('rejects inverted clipping rectangles',()=>{
 const bytes=media(2).slice(),v=new DataView(bytes.buffer);v.setInt32(offsets(bytes,84)[0]+64,0,true);expect(()=>emfInfo(bytes)).toThrow(/clipping rectangle/);
});
