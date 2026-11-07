import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/border-position-getters/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
it('preserves authored coordinates despite native position getter offsets across border widths and exact heights',()=>{
 let count=0;const widths=new Set(),heights=new Set();
 for(const s of ref.sources){
  expect(sha(readFileSync(resolve(folder,s.source)))).toBe(s.sourceSha256);
  const rawCases=readFileSync(resolve(folder,s.cases));expect(sha(rawCases)).toBe(s.casesSha256);
  const raw=readFileSync(folder+s.metadata);expect(sha(raw)).toBe(s.metadataSha256);
  const metadata=JSON.parse(raw.toString('utf8').replace(/^\uFEFF/,'')),cases=JSON.parse(rawCases);
  expect(metadata).toMatchObject({referenceBuild:ref.referenceBuild,sourceUnchanged:true,sourceSha256:s.sourceSha256,savedBefore:true,savedAfter:true,characters:''});
  expect(metadata.tables.length).toBe(cases.length);expect(cases.length).toBe(s.tables);
  for(const [i,c] of cases.entries()){
   const t=metadata.tables[i];expect(t.id).toBe(i+1);expect(t.heightRule).toBe(2);expect(t.wrapAround).toBe(-1);
   expect(t.heightPt*20).toBeCloseTo(c.heightTwips,5);
   expect(t.xPt*20-c.xTwips).toBeCloseTo(-1,5);expect(t.yPt*20-c.yTwips).toBeCloseTo(-1,5);
   expect(Number(t.memoryXTwips)).toBe(c.xTwips);expect(Number(t.memoryYTwips)).toBe(c.yTwips);
   widths.add(c.size);heights.add(c.heightTwips);count++;
  }
 }
 expect(count).toBe(188);expect([...widths].sort((a,b)=>a-b)).toEqual([2,18]);
 expect([...heights].sort((a,b)=>a-b)).toEqual([120,473,479,481,487]);
});
