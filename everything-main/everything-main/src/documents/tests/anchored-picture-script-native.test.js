import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
const folder='tests/fixtures/anchored-picture-script/';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const hash=name=>createHash('sha256').update(readFileSync(folder+name)).digest('hex');
it('ties native script observations to original controls and the captured native reference PDF',()=>{
 expect(hash('control.docx')).toBe(reference.sourceSha256);expect(hash('native.pdf')).toBe(reference.pdfSha256);
 expect(reference.cases.map(({bounds,pixelsSha256,...c})=>c)).toEqual(JSON.parse(readFileSync(folder+'cases.json','utf8')));
 const xml=strFromU8(unzipSync(readFileSync(folder+'control.docx'))['word/document.xml']);
 expect(xml.match(/<wp:anchor /g)).toHaveLength(6);expect(xml.match(/<wp:inline[ >]/g)).toHaveLength(3);expect(xml.match(/<w:vertAlign /g)).toHaveLength(9);
});
it('records unchanged picture size, position and raster across all three script values in each placement mode',()=>{
 for(const mode of ['page','paragraph','inline']){
  const cases=reference.cases.filter(c=>c.mode===mode);expect(cases.map(c=>c.script)).toEqual(['baseline','subscript','superscript']);
  for(const c of cases){expect(c.bounds).toEqual(cases[0].bounds);expect(c.pixelsSha256).toBe(cases[0].pixelsSha256);}
 }
});
