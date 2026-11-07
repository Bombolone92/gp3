import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const root='tests/fixtures/picture-3d-textures/',device=root+'device/';
const ref=JSON.parse(readFileSync(device+'reference.json'));
const capture=JSON.parse(readFileSync(device+'capture.json','utf8').replace(/^\uFEFF/,''));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
it('binds all eight full-color page fields to unchanged independently authored textures',()=>{
 expect(hash(readFileSync(root+'control.docx'))).toBe(ref.sourceSha256);
 expect(capture.sourceSha256).toBe(ref.sourceSha256);
 expect(capture).toMatchObject({sourceUnchanged:true,savedBefore:true,savedAfter:true});
 expect(capture.captures).toHaveLength(8);expect(ref.cases).toHaveLength(8);
 for(const [i,c] of capture.captures.entries()){
  const emf=gunzipSync(readFileSync(device+c.file+'.gz'));
  expect(hash(emf)).toBe(c.sha256);expect(emf.length).toBe(c.length);
  expect(c).toMatchObject({widthPt:612,heightPt:792});
  const field=ref.cases[i];expect(hash(readFileSync(device+field.png))).toBe(field.pngSha256);
  expect(field.samples).toHaveLength(49);
 }
});
