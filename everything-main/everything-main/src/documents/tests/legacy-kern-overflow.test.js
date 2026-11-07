import {it,expect}from 'vitest';
import {splitOverflowingKern}from '../src/engine/legacy-kern-overflow.js';
import {repairLegacyKerning}from '../src/engine/legacy-kerning-font.js';
import {readFontMetadata}from '../src/engine/font-metadata.js';
import {overflowKern,overflowFont}from './helpers/overflow-kern.js';
function tables(buffer){const v=new DataView(buffer);return new Map(Array.from({length:v.getUint16(4)},(_,i)=>{const p=12+i*16;return [String.fromCharCode(...new Uint8Array(buffer,p,4)),new Uint8Array(buffer.slice(v.getUint32(p+8),v.getUint32(p+8)+v.getUint32(p+12)))];}));}
it.each([10921,18694,65535])('retains all %i sorted pair records in valid-length subtables',count=>{
 const source=overflowKern(count),before=source.slice(),out=splitOverflowingKern(source),v=new DataView(out.buffer),pairs=[];let at=4;
 for(let i=0;i<v.getUint16(2);i++){const n=v.getUint16(at+6),size=v.getUint16(at+2),selector=Math.floor(Math.log2(n));expect(size).toBe(14+6*n);expect(size).toBeLessThanOrEqual(65535);expect(v.getUint16(at+4)).toBe(1);expect(v.getUint16(at+8)).toBe(6*2**selector);expect(v.getUint16(at+10)).toBe(selector);expect(v.getUint16(at+12)).toBe(6*(n-2**selector));pairs.push(...out.subarray(at+14,at+size));at+=size;}
 expect(at).toBe(out.length);expect(Buffer.from(pairs).equals(Buffer.from(source.subarray(18)))).toBe(true);expect(Buffer.from(source).equals(Buffer.from(before))).toBe(true);
});
it('rejects non-overflows, ambiguous coverage, versions, lengths and unordered pairs',()=>{
 expect(splitOverflowingKern(overflowKern(10920))).toBeNull();
 for(const mutate of [v=>v.setUint16(0,1),v=>v.setUint16(2,2),v=>v.setUint16(4,1),v=>v.setUint16(6,123),v=>v.setUint16(8,9),v=>v.setUint16(8,0x101),v=>v.setUint16(10,0),v=>v.setUint32(24,v.getUint32(18)),v=>v.setUint32(24,0)]){const b=overflowKern();mutate(new DataView(b.buffer));expect(splitOverflowingKern(b)).toBeNull();}
 const b=overflowKern();for(const n of [0,1,17,b.length-1])expect(splitOverflowingKern(b.slice(0,n))).toBeNull();
});
it.each([true,false])('rebuilds checksums, preserves unrelated bytes, and removes only empty GPOS (%s)',emptyGpos=>{
 const source=overflowFont({emptyGpos}),before=source.slice(0),out=repairLegacyKerning(source);expect(out).not.toBeNull();const a=tables(source),b=tables(out);expect(b.has('GPOS')).toBe(false);expect(readFontMetadata(out)).toMatchObject({legacyKerning:true,glyphPositioning:false});
 for(const[tag,data]of a)if(!['head','kern','GPOS'].includes(tag))expect(b.get(tag),tag).toEqual(data);
 const head=b.get('head').slice();head.fill(0,8,12);expect(head).toEqual(a.get('head'));
 const v=new DataView(out);let sum=0;for(let at=0;at<out.byteLength;at+=4)sum=(sum+v.getUint32(at))>>>0;expect(sum).toBe(0xb1b0afba);expect(source).toEqual(before);
});
it('leaves variable and active/unknown GPOS faces unchanged',()=>{
 expect(repairLegacyKerning(overflowFont({variable:true}))).toBeNull();const b=overflowFont(),v=new DataView(b);for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(v.getUint32(p)===0x47504f53)v.setUint32(v.getUint32(p+8),0x20000);}expect(repairLegacyKerning(b)).toBeNull();expect(repairLegacyKerning(new ArrayBuffer(0))).toBeNull();
});
