import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
it('binds exact native CMYK conversion samples to the original control and reference metafile',()=>{
 const root='tests/fixtures/cmyk-jpeg/',ref=JSON.parse(readFileSync(root+'native-metafile-reference.json'));
 const data=readFileSync(root+'native-metafile.emf'),hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(data)).toBe(ref.metafileSha256);expect(hash(readFileSync(root+'control.docx'))).toBe(ref.sourceSha256);
 const pictures=[];
 for(let p=0;p<data.length;){
  const type=data.readUInt32LE(p),size=data.readUInt32LE(p+4);expect(size).toBeGreaterThanOrEqual(8);expect(p+size).toBeLessThanOrEqual(data.length);
  if(type===81){
   const bmi=p+data.readUInt32LE(p+48),bits=p+data.readUInt32LE(p+56);
   expect(data.readUInt32LE(bmi)).toBe(40);expect(data.readInt32LE(bmi+4)).toBe(256);expect(data.readInt32LE(bmi+8)).toBe(128);
   expect(data.readUInt16LE(bmi+14)).toBe(8);expect(data.readUInt32LE(bmi+16)).toBe(0);
   pictures.push(Array.from({length:16},(_,i)=>{const palette=bmi+40+4*data[bits+(127-(Math.floor(i/4)*32+16))*256+(i%4)*64+32];return [data[palette+2],data[palette+1],data[palette]];}));
  }
  p+=size;
 }
 expect(pictures).toEqual([ref.colors]);
 expect(ref.gdiDecodes[0].colors).toEqual(ref.gdiDecodes[1].colors);
 // Keep the two native representations distinct; PDF recompression is not
 // an exact reference for the metafile's converted RGB palette.
 expect(ref.colors).not.toEqual(ref.pdfColors);
});
