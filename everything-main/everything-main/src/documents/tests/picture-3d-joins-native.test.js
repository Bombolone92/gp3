import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
const folder='tests/fixtures/picture-3d-joins/';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const hash=name=>createHash('sha256').update(readFileSync(folder+name)).digest('hex');
it('ties the fourteen native observations to the independently authored source and native reference PDF',()=>{
 expect(hash('source.docx')).toBe(reference.sourceSha256);expect(hash('native.pdf')).toBe(reference.pdfSha256);
 const cases=JSON.parse(readFileSync(folder+'cases.json','utf8'));expect(reference.cases.map(({samples,outline,...c})=>c)).toEqual(cases);
 expect(cases).toHaveLength(14);expect(cases.filter(c=>c.extension)).toHaveLength(2);
 expect(strFromU8(unzipSync(readFileSync(folder+'source.docx'))['word/document.xml']).match(/<a:miter/g)).toHaveLength(10);
 for(const c of reference.cases){expect(c.samples.length).toBeGreaterThan(100);for(const p of c.samples)expect(p.rgb).toHaveLength(3);}
});
it('records sharp versus clipped joins and the neutral closed-frame cap/metadata behavior in the native reference',()=>{
 const same=(first,second)=>reference.comparisons.find(c=>c.first===first&&c.second===second)?.identical;
 for(const prefix of ['flat-','solid-']){
  for(const suffix of ['miter-default','square-cap','neutral-sketch'])expect(same(prefix+'miter-eight',prefix+suffix)).toBe(true);
  expect(same(prefix+'miter-eight',prefix+'miter-one')).toBe(false);
 }
 expect(same('flat-miter-eight','flat-round')).toBe(false);
 expect(same('solid-miter-eight','solid-round')).toBe(true);
});
