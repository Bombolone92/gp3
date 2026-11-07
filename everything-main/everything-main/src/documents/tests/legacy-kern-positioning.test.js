import {it,expect} from 'vitest';
import {legacyKernPositioning} from '../src/engine/legacy-kern-positioning.js';
import {legacyKerningAsPositioning} from '../src/engine/legacy-kerning-font.js';
import {overflowKern,overflowFont} from './helpers/overflow-kern.js';

// Decode through the public OpenType offsets, independently of the writer's
// chosen byte positions. Assert the DFLT language enables the kern lookup.
function pairs(bytes){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),u=p=>v.getUint16(p),tag=p=>v.getUint32(p);
 expect(tag(0)).toBe(0x10000);
 const scripts=u(4),features=u(6),lookups=u(8);
 expect(u(scripts)).toBe(1);expect(tag(scripts+2)).toBe(0x44464c54);
 const script=scripts+u(scripts+6),lang=script+u(script);
 expect(u(lang+2)).toBe(65535);expect(u(lang+4)).toBe(1);expect(u(lang+6)).toBe(0);
 expect(u(features)).toBe(1);expect(tag(features+2)).toBe(0x6b65726e);
 const feature=features+u(features+6);expect(u(feature+2)).toBe(1);expect(u(feature+4)).toBe(0);
 expect(u(lookups)).toBe(1);const lookup=lookups+u(lookups+2);
 expect(u(lookup)).toBe(9);expect(u(lookup+2)).toBe(0);
 const result=[];
 for(let i=0;i<u(lookup+4);i++){
  const extension=lookup+u(lookup+6+2*i);expect(u(extension)).toBe(1);expect(u(extension+2)).toBe(2);
  const sub=extension+tag(extension+4),coverage=sub+u(sub+2);
  expect(u(sub)).toBe(1);expect(u(sub+4)).toBe(4);expect(u(sub+6)).toBe(0);
  expect(u(coverage)).toBe(1);expect(u(coverage+2)).toBe(u(sub+8));
  for(let j=0;j<u(sub+8);j++){
   const first=u(coverage+4+2*j),set=sub+u(sub+10+2*j);
   for(let k=0;k<u(set);k++)result.push([first,u(set+2+4*k),v.getInt16(set+4+4*k)]);
  }
 }
 return result;
}
it.each([3,20000,65535])('preserves all %i pair advances across extension boundaries',count=>{
 const source=overflowKern(count),v=new DataView(source.buffer),expected=[];
 for(let i=0;i<count;i++){
  const first=1+Math.floor(i/100),second=i%100,advance=i%3===0?-205:i%3===1?70:0;
  v.setUint16(18+6*i,first);v.setUint16(20+6*i,second);v.setInt16(22+6*i,advance);expected.push([first,second,advance]);
 }
 const before=source.slice();expect(pairs(legacyKernPositioning(source))).toEqual(expected);expect(source).toEqual(before);
});
it('rejects ambiguous coverage, ordering, lengths and an oversized single pair set',()=>{
 for(const change of [v=>v.setUint16(0,1),v=>v.setUint16(2,2),v=>v.setUint16(4,1),v=>v.setUint16(6,1),v=>v.setUint16(8,9),v=>v.setUint16(10,0),v=>v.setUint32(24,v.getUint32(18))]){
  const bytes=overflowKern(3);change(new DataView(bytes.buffer));expect(legacyKernPositioning(bytes)).toBeNull();
 }
 for(const length of [0,1,17,35])expect(legacyKernPositioning(overflowKern(3).slice(0,length))).toBeNull();
 expect(legacyKernPositioning(overflowKern(18694))).toBeNull();
});
function tables(buffer){const v=new DataView(buffer);return new Map(Array.from({length:v.getUint16(4)},(_,i)=>{const p=12+16*i,at=v.getUint32(p+8);return [v.getUint32(p),new Uint8Array(buffer.slice(at,at+v.getUint32(p+12)))];}));}
it.each([false,true])('preserves unrelated SFNT tables and checksums with empty GPOS=%s',emptyGpos=>{
 const source=overflowFont({count:10,emptyGpos}),before=source.slice(0),result=legacyKerningAsPositioning(source),a=tables(source),b=tables(result);
 expect(b.has(0x6b65726e)).toBe(false);expect(pairs(b.get(0x47504f53))).toHaveLength(10);
 for(const[tag,bytes]of a)if(![0x68656164,0x6b65726e,0x47504f53].includes(tag))expect(b.get(tag)).toEqual(bytes);
 const head=b.get(0x68656164).slice();head.fill(0,8,12);expect(head).toEqual(a.get(0x68656164));
 let sum=0;const v=new DataView(result);for(let i=0;i<result.byteLength;i+=4)sum=(sum+v.getUint32(i))>>>0;
 expect(sum).toBe(0xb1b0afba);expect(source).toEqual(before);
});
it('retains unsupported and variable font data unchanged',()=>{
 expect(legacyKerningAsPositioning(overflowFont({count:10,variable:true}))).toBeNull();
 expect(legacyKerningAsPositioning(new ArrayBuffer(0))).toBeNull();
 const source=overflowFont({count:10}),v=new DataView(source);
 for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(v.getUint32(p)===0x47504f53)v.setUint32(v.getUint32(p+8),0x20000);}
 expect(legacyKerningAsPositioning(source)).toBeNull();
});
