import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/shadow-alpha-pipeline/';
const ref=JSON.parse(readFileSync(root+'reference.json'));
it('binds translucent source controls and complete native shadow pixel histograms',()=>{
 for(const[file,hash]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(root+file)).digest('hex'),file).toBe(hash);
 expect(ref.cases).toHaveLength(24);
 for(const r of ref.cases){
  expect(r.images[1].centerRgba).toEqual([0,0,0,r.sourceAlpha]);
  for(const im of r.images)expect(im.histogram.reduce((n,p)=>n+p.count,0)).toBe(im.size[0]*im.size[1]);
 }
});
it('rejects final-alpha-only conversion for colored blur while retaining successful controls',()=>{
 const unblurred=ref.cases.filter(r=>r.blurPt===0),white=ref.cases.filter(r=>r.color==='FFFFFF');
 expect(unblurred).toHaveLength(6);expect(white).toHaveLength(12);
 for(const r of [...unblurred,...white])expect(r.mismatchPixels,r.name).toBe(0);
 const colored=ref.cases.filter(r=>r.blurPt>0&&r.color==='8040C0');expect(colored).toHaveLength(9);
 for(const r of colored){
  expect(r.mismatchPixels,r.name).toBeGreaterThan(0);
  const atFive=r.images[0].histogram.filter(p=>p.rgba[3]===5).map(p=>p.rgba.slice(0,3));
  expect(atFive,r.name).toContainEqual([102,51,204]);
  expect(atFive,r.name).toContainEqual([153,51,204]);
 }
});
