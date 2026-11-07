// Original minimal SFNT metadata container, without glyphs or third-party data.
export function metadataFont({weight=400,bold=false,unitsPerEm=2048,variable=false,legacyKerning=false,glyphPositioning=false,widthClass=5,cmapLanguage,cmapPlatform=3}={}) {
 const extras=[...(variable?['fvar']:[]),...(legacyKerning?['kern']:[]),...(glyphPositioning?['GPOS']:[]),...(cmapLanguage===undefined?[]:['cmap'])];
 const count=2+extras.length,head=12+16*count,os2=head+56,buffer=new ArrayBuffer(os2+64+extras.reduce((n,tag)=>n+(tag==='cmap'?24:4),0)),v=new DataView(buffer);
 v.setUint32(0,0x00010000);v.setUint16(4,count);
 const table=(i,tag,offset,length)=>{const p=12+i*16;[...tag].forEach((c,j)=>v.setUint8(p+j,c.charCodeAt(0)));v.setUint32(p+8,offset);v.setUint32(p+12,length);};
 table(0,'head',head,54);table(1,'OS/2',os2,64);let offset=os2+64;extras.forEach((tag,i)=>{
  const length=tag==='cmap'?24:4;table(i+2,tag,offset,length);
  if(tag==='cmap'){v.setUint16(offset+2,1);v.setUint16(offset+4,cmapPlatform);v.setUint16(offset+6,1);v.setUint32(offset+8,12);v.setUint16(offset+12,6);v.setUint16(offset+14,12);v.setUint16(offset+16,cmapLanguage);v.setUint16(offset+18,65);v.setUint16(offset+20,1);v.setUint16(offset+22,1);}
  offset+=length;
 });
 v.setUint32(head+12,0x5f0f3cf5);v.setUint16(head+18,unitsPerEm);v.setUint16(os2+4,weight);v.setUint16(os2+6,widthClass);v.setUint16(os2+62,bold?32:64);
 return buffer;
}
