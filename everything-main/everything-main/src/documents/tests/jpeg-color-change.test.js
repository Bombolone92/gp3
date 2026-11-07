import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {colorChangePixels} from '../src/engine/picture-color-change.js';
const root='tests/fixtures/jpeg-color-change/';
const grid=JSON.parse(readFileSync(root+'thresholds.json')),native=JSON.parse(readFileSync(root+'reference.json'));
const composite=rgba=>rgba.slice(0,3).map((v,k)=>Math.round(v*rgba[3]/255+[102,153,170][k]*(1-rgba[3]/255)));
it('binds independent native observations to the source and PDF',()=>{
 for(const [file,key] of [['thresholds.docx','sourceSha256'],['thresholds-native.pdf','pdfSha256']])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(native[key]);
});
it.each(grid.cases.map((c,i)=>[i,c]))('matches native JPEG/PNG threshold grid %i', (index,[format,key,use,alpha,replacement])=>{
 const data=Uint8ClampedArray.from(grid.decoded.flatMap(rgb=>[...rgb,255]));
 colorChangePixels(data,{from:{rgb:key,alpha:alpha/100000},to:{rgb:'1177DD',alpha:replacement/100000},useAlpha:use!=='0'},format==='JPEG'?'image/jpeg':'image/png');
 // The native reference re-encodes the two unchanged JPEG cases in its PDF (max two-byte
 // sample difference). Their alpha and the engine's unchanged bytes are exact.
 const recompressed=native.pdfFilters[index]==='/DCTDecode';
 if(recompressed){expect([...data]).toEqual(grid.decoded.flatMap(rgb=>[...rgb,255]));expect(native.samples[index].every(s=>s[3]===255)).toBe(true);}
 for(let j=0;j<grid.decoded.length;j++){
  const actual=composite([...data.slice(j*4,j*4+4)]),expected=composite(native.samples[index][j]);
  for(let k=0;k<3;k++)expect(Math.abs(actual[k]-expected[k]),`${index}/${j}/${k}`).toBeLessThanOrEqual(recompressed?2:1);
 }
});
