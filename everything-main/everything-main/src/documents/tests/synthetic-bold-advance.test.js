import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
const folder='tests/fixtures/synthetic-bold-advance/';
it('binds original controls, native fit thresholds and PDFs to their captured bytes',()=>{
 const hashes=JSON.parse(readFileSync(folder+'hashes.json'));
 for(const [name,hash]of Object.entries(hashes))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex'),name).toBe(hash);
 for(const name of ['modern','thousand','ligatures','weights']){
  const cases=JSON.parse(readFileSync(folder+name+'-cases.json'));
  const native=JSON.parse(readFileSync(folder+name+'-native.json','utf8').replace(/^\uFEFF/,''));
  const source=name==='weights'?'../synthetic-bold/weights.docx':name+'.docx';
  expect(native.sourceSha256).toBe(hashes[source]);expect(native.cases).toHaveLength(cases.length);
  const parts=unzipSync(readFileSync(folder+source));
  expect(Object.keys(parts).some(p=>/fonts\//.test(p))).toBe(false);
  expect(strFromU8(parts['word/document.xml']).match(/<w:p>/g)).toHaveLength(cases.length);
  cases.forEach((c,i)=>{expect(native.cases[i]).toMatchObject({index:i,family:c.family,size:c.size,bold:c.bold,nativeFont:c.family,nativeSize:c.size,nativeKerning:0});expect(native.cases[i].minimumTwips).toBeGreaterThan(0);});
 }
});
