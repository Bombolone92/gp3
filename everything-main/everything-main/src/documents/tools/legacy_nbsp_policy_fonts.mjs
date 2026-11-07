import {Font,Glyph,Path,parse} from '../src/vendor/opentype/opentype.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import { fileURLToPath } from 'node:url';
const out=process.argv[2] || fileURLToPath(new URL('../tests/fixtures/legacy-nbsp-font-policy',import.meta.url));mkdirSync(out,{recursive:true});
const rect=(w,h)=>{const p=new Path();p.moveTo(30,0);p.lineTo(w,0);p.lineTo(w,h);p.lineTo(30,h);p.close();return p;};
function withKern(buffer){
 const v=new DataView(buffer),tables=new Map();for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;const tag=String.fromCharCode(...new Uint8Array(buffer,p,4));tables.set(tag,new Uint8Array(buffer.slice(v.getUint32(p+8),v.getUint32(p+8)+v.getUint32(p+12))));}
 tables.delete('GPOS');tables.delete('DSIG');const kern=new Uint8Array(30),k=new DataView(kern.buffer);k.setUint16(2,1);k.setUint16(6,26);k.setUint16(8,1);k.setUint16(10,2);k.setUint16(12,12);k.setUint16(14,1);
 [[1,3,-100],[4,3,-200]].forEach(([l,r,a],i)=>{k.setUint16(18+i*6,l);k.setUint16(20+i*6,r);k.setInt16(22+i*6,a);});tables.set('kern',kern);
 const headView=new DataView(tables.get('head').buffer);headView.setUint32(8,0);headView.setBigUint64(20,3873604927n);headView.setBigUint64(28,3873604927n);const entries=[...tables].sort(([a],[b])=>a.localeCompare(b));let offset=12+entries.length*16;const result=new ArrayBuffer(offset+entries.reduce((s,[,b])=>s+Math.ceil(b.length/4)*4,0)),rv=new DataView(result),rb=new Uint8Array(result);const power=2**Math.floor(Math.log2(entries.length));rv.setUint32(0,v.getUint32(0));rv.setUint16(4,entries.length);rv.setUint16(6,power*16);rv.setUint16(8,Math.log2(power));rv.setUint16(10,entries.length*16-power*16);let head;
 const sum=(start,length)=>{let s=0;for(let at=start;at<start+Math.ceil(length/4)*4;at+=4)s=(s+rv.getUint32(at))>>>0;return s;};
 entries.forEach(([tag,b],i)=>{const at=12+i*16;[...tag].forEach((c,j)=>rv.setUint8(at+j,c.charCodeAt(0)));rb.set(b,offset);rv.setUint32(at+4,sum(offset,b.length));rv.setUint32(at+8,offset);rv.setUint32(at+12,b.length);if(tag==='head')head=offset;offset+=Math.ceil(b.length/4)*4;});rv.setUint32(head+8,(0xb1b0afba-sum(0,result.byteLength))>>>0);return result;
}
const cases=[];
for(const [suffix,width,ink] of [['Equal',250,false],['Wide',600,false],['Ink',600,true]]){
 const aAdvance=suffix==='Equal'?600:suffix==='Wide'?800:1000;const family='NBSP Distinct '+suffix,glyphs=[new Glyph({name:'.notdef',advanceWidth:500,path:new Path()}),new Glyph({name:'space',unicode:32,advanceWidth:250,path:new Path()}),new Glyph({name:'A',unicode:65,advanceWidth:aAdvance,path:rect(aAdvance-100,700)}),new Glyph({name:'W',unicode:87,advanceWidth:700,path:rect(600,400)}),new Glyph({name:'nbspace',unicode:160,advanceWidth:width,path:ink?rect(400,200):new Path()})];
 const data=withKern(new Font({familyName:family,styleName:'Regular',unitsPerEm:1000,ascender:800,descender:-200,glyphs}).toArrayBuffer());
 const check=parse(data);if(check.getKerningValue(1,3)!==-100||check.getKerningValue(4,3)!==-200)throw Error('Bad pairs');
 const file=suffix+'.otf';writeFileSync(out+'/'+file,new Uint8Array(data));cases.push({family,file,width,ink,aAdvance});
}writeFileSync(out+'/fonts.json',JSON.stringify(cases,null,2));console.log(out);
