import { expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const folder='tests/fixtures/script-size/';
const ref=JSON.parse(readFileSync(folder+'reference.json','utf8'));
const cases=JSON.parse(readFileSync(folder+'cases.json','utf8'));
const hash=path=>createHash('sha256').update(readFileSync(folder+path)).digest('hex');
const row=(family,face,size,script='superscript')=>ref.cases.find(c=>c.family===family&&c.face===face).rows.find(r=>r.size===size&&r.script===script);

it('binds all 108 independent reference script cases to the reviewed source and native PDF',()=>{
 expect(ref.sourceSha256).toBe(hash('control.docx'));expect(ref.pdfSha256).toBe(hash('native.pdf'));
 expect(ref.cases).toHaveLength(9);
 expect(ref.cases.map(c=>({...c,rows:c.rows.map(({size,script})=>({size,script}))}))).toEqual(cases);
 for(const c of ref.cases){expect(c.rows).toHaveLength(12);for(const r of c.rows){expect(r.nativeSize).toBeGreaterThan(0);expect(r.nativeSize).toBeLessThan(r.size);expect(r.followingX).toBeGreaterThan(r.scriptX);}}
});

it('rules out a universal ratio or the font table’s vertical-size field alone',()=>{
 for(const family of ['Garamond','Arial','Times New Roman'])for(const face of ref.fonts[family]){
  expect(face.unitsPerEm).toBe(2048);expect(face.os2ScriptMetrics[5]).toBe(1331);
 }
 expect(row('Garamond','regular',12).nativeSize).toBe(6.96);
 expect(row('Arial','regular',12).nativeSize).toBe(8.04);
 expect(row('Times New Roman','regular',12).nativeSize).toBe(8.04);
 expect(row('Garamond','regular',10).nativeSize).toBe(6.48);
 expect(row('Garamond','italic',10).nativeSize).toBe(6);
});

it('records size-dependent transitions and face-dependent baseline placement',()=>{
 expect([8,10,11,12,16,20].map(size=>row('Garamond','regular',size).nativeSize)).toEqual([5.04,6.48,6.96,6.96,9.48,12]);
 expect(row('Garamond','regular',11).rise).toBeCloseTo(2.52);
 expect(row('Garamond','regular',12).rise).toBeCloseTo(4.56);
 expect(row('Arial','italic',12).rise).toBeCloseTo(3.48);
 expect(row('Arial','regular',12).rise).toBeCloseTo(3.96);
 for(const c of ref.cases)for(const size of [8,10,11,12,16,20])expect(row(c.family,c.face,size,'subscript').nativeSize).toBe(row(c.family,c.face,size).nativeSize);
});
