import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
it('binds native heading metrics to their original source and native reference PDF',()=>{
 const root='tests/fixtures/native-heading-line-metrics/',ref=JSON.parse(readFileSync(root+'reference.json'));
 for(const [name,key] of [['control.docx','sourceSha256'],['native.pdf','pdfSha256'],['cases.json','casesSha256']])
  expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(ref[key]);
 const cases=JSON.parse(readFileSync(root+'cases.json'));
 expect(cases).toHaveLength(46);expect(ref.pages.map(p=>p.case)).toEqual(cases);
 for(const p of ref.pages){expect(p.sampleBaselineSteps).toHaveLength(2);expect(p.sampleBaselineSteps.every(n=>n>0)).toBe(true);}
});
