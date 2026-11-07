import {it,expect} from 'vitest';
import {syntheticAdvanceFont} from '../src/engine/synthetic-advance-font.js';
function fixture({width=500,count=2,glyphs=4,weight=300,bold=false,variable=false}={}) {
 const tables=new Map([['head',new Uint8Array(54)],['OS/2',new Uint8Array(64)],['hhea',new Uint8Array(36)],['hmtx',new Uint8Array(12)],['maxp',new Uint8Array(6)],['GSUB',new Uint8Array([1,2,3,4,5])],['DSIG',new Uint8Array([9,8,7,6])],['hdmx',new Uint8Array([0,1,2,3])]]);
 if(variable)tables.set('fvar',new Uint8Array(16));
 const view=name=>new DataView(tables.get(name).buffer);
 view('head').setUint32(12,0x5f0f3cf5);view('head').setUint16(18,1000);view('OS/2').setUint16(4,weight);view('OS/2').setUint16(62,bold?32:0);
 view('hhea').setUint16(10,width);view('hhea').setUint16(34,count);view('maxp').setUint16(4,glyphs);
 view('hmtx').setUint16(4,width);view('hmtx').setInt16(2,-2);view('hmtx').setInt16(6,3);view('hmtx').setInt16(8,-4);view('hmtx').setInt16(10,5);
 const start=12+tables.size*16,buffer=new ArrayBuffer(start+[...tables.values()].reduce((n,a)=>n+Math.ceil(a.length/4)*4,0));
 const v=new DataView(buffer);v.setUint32(0,0x10000);v.setUint16(4,tables.size);let offset=start,i=0;
 for(const [tag,data]of tables){const p=12+i++*16;[...tag].forEach((c,j)=>v.setUint8(p+j,c.charCodeAt(0)));v.setUint32(p+8,offset);v.setUint32(p+12,data.length);new Uint8Array(buffer).set(data,offset);offset+=Math.ceil(data.length/4)*4;}
 return buffer;
}
function tables(buffer){const v=new DataView(buffer),r=new Map();for(let i=0;i<v.getUint16(4);i++){const p=12+i*16,tag=String.fromCharCode(...new Uint8Array(buffer,p,4));r.set(tag,new DataView(buffer,v.getUint32(p+8),v.getUint32(p+12)));}return r;}
it('adjusts advancing glyphs, including shared final metrics, without changing marks or shaping tables',()=>{
 const source=fixture(),before=source.slice(0),derived=syntheticAdvanceFont(source),t=tables(derived);
 expect(source).toEqual(before);expect(t.get('hmtx').getUint16(0)).toBe(0);expect(t.get('hmtx').getUint16(4)).toBe(501);
 expect([2,6,8,10].map(n=>t.get('hmtx').getInt16(n))).toEqual([-2,3,-4,5]);expect(t.get('hhea').getUint16(10)).toBe(501);expect(t.get('hhea').getUint16(34)).toBe(2);
 expect([...new Uint8Array(derived,t.get('GSUB').byteOffset,t.get('GSUB').byteLength)]).toEqual([1,2,3,4,5]);
 expect(t.has('DSIG')).toBe(false);expect(t.has('hdmx')).toBe(false);
 const v=new DataView(derived);let sum=0;for(let i=0;i<derived.byteLength;i+=4)sum=(sum+v.getUint32(i))>>>0;expect(sum).toBe(0xb1b0afba);
});
it('rejects unsupported or unsafe metric edits without modifying the original',()=>{
 for(const options of [{width:65535},{count:0},{count:5},{glyphs:100},{weight:700},{weight:900},{bold:true},{variable:true}]){const source=fixture(options),copy=source.slice(0);expect(syntheticAdvanceFont(source)).toBeNull();expect(source).toEqual(copy);}
 expect(syntheticAdvanceFont(new ArrayBuffer(0))).toBeNull();const truncated=fixture().slice(0,60);expect(syntheticAdvanceFont(truncated)).toBeNull();
});
