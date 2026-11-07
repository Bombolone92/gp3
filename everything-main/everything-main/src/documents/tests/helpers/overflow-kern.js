import {metadataFont} from './sfnt-metadata.js';
export function overflowKern(count=18694){
 const b=new Uint8Array(18+6*count),v=new DataView(b.buffer);v.setUint16(2,1);v.setUint16(6,(14+6*count)&65535);v.setUint16(8,1);v.setUint16(10,count);
 for(let i=0;i<count;i++){v.setUint32(18+i*6,i+65536);v.setInt16(22+i*6,(i%101)-50);}return b;
}
export function overflowFont({count=18694,emptyGpos=true,variable=false}={}){
 const base=metadataFont({legacyKerning:true,glyphPositioning:emptyGpos,variable}),kern=overflowKern(count),offset=Math.ceil(base.byteLength/4)*4,b=new Uint8Array(offset+kern.length+(emptyGpos?16:0)),v=new DataView(b.buffer);b.set(new Uint8Array(base));b.set(kern,offset);
 for(let i=0;i<v.getUint16(4);i++){const p=12+i*16,tag=v.getUint32(p);if(tag===0x6b65726e){v.setUint32(p+8,offset);v.setUint32(p+12,kern.length);}if(tag===0x47504f53){const at=offset+kern.length;v.setUint32(p+8,at);v.setUint32(p+12,16);v.setUint32(at,0x10000);v.setUint16(at+4,10);v.setUint16(at+6,12);v.setUint16(at+8,14);}}
 return b.buffer;
}
