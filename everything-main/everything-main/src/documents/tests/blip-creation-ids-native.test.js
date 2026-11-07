import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/blip-creation-ids/';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
it('ties the unchanged native reference raster to both independently authored controls and PDF captures',()=>{
 expect(hash(folder+'control.docx')).toBe(reference.sourceSha256);
 expect(hash('public/fixtures/drawing-creation-ids.docx')).toBe(reference.baselineSha256);
 expect(hash(folder+'native.pdf')).toBe(reference.pdfSha256);
 expect(hash(folder+'baseline-native.pdf')).toBe(reference.baselinePdfSha256);
 expect(reference.pages).toHaveLength(1);
 expect(reference.pages[0]).toMatchObject({page:1,size:[864,864],identical:true});
 expect(reference.pages[0].rgbSha256).toMatch(/^[a-f0-9]{64}$/);
});
