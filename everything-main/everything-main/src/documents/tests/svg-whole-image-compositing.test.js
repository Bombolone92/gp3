import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const e=JSON.parse(readFileSync('tests/fixtures/measurements/svg-whole-image-compositing.json'));
it('retains full-image rejection evidence with stable comparison pixels',()=>{
 for(const profile of Object.values(e.profiles)){
  const b=readFileSync(profile.file);
  for(const [key,positions] of Object.entries({bounds:[8,12,16,20],frame:[24,28,32,36],device:[72,76,80,84],micrometers:[100,104]}))
   expect(profile[key]).toEqual(positions.map(p=>b.readInt32LE(p)));
 }
 for(const scope of Object.values(e.wholeImage)){
  expect(scope.paths.composite.matches).toBe(36);
  for(const [mode,path] of Object.entries(scope.paths))path.pixels.forEach((p,i)=>{
   expect(p.baselinePixelSha256).toBe(scope.paths.baseline.pixels[i].baselinePixelSha256);
   expect(p.changedPixels).toBe(p.improvedPixels+p.worsenedPixels+p.equalErrorChangedPixels);
   if(mode==='composite'){expect(p.worsenedPixels).toBeGreaterThan(0);expect(p.afterL1).toBeLessThan(p.beforeL1);}
   else expect(p.changedPixels).toBe(0);
  });
 }
 expect(e.wholeImage.internal.paths.composite.pixels[0].worsenedPixels).toBe(10472);
 expect(e.wholeImage.external.paths.composite.pixels.map(p=>p.worsenedPixels)).toEqual([9614,9901,8332,10709]);
});
it('exhausts all byte-pixel models for all hash-bound native backdrop tuples',()=>{
 const backgrounds=['FFFFFF','F2F2F2','808080','202020'].map(h=>h.match(/../g).map(n=>parseInt(n,16)));
 for(const [bg,hash] of Object.entries(e.flattening.hashes))expect(createHash('sha256').update(readFileSync(`tests/fixtures/svg-external-backdrop/${bg}.png`)).digest('hex')).toBe(hash);
 expect(e.flattening.tuples).toHaveLength(31);
 expect(e.flattening.tuples.reduce((sum,r)=>sum+r.pixels,0)).toBe(1200*900);
 for(const row of e.flattening.tuples){
  const solutions=[];
  for(let alpha=0;alpha<=255;alpha++){
   const channels=[0,1,2].map(c=>backgrounds.map((bg,i)=>row.colors[i][c]-Math.floor((bg[c]*(255-alpha)+127)/255)));
   if(channels.every(v=>v.every(n=>n===v[0])&&v[0]>=0&&v[0]<=alpha))solutions.push({alpha,premultiplied:channels.map(v=>v[0])});
  }
  expect(row.solutions).toEqual(solutions);
 }
 const rejected=e.flattening.tuples.filter(r=>!r.solutions.length);
 expect(rejected).toHaveLength(13);expect(rejected.reduce((sum,r)=>sum+r.pixels,0)).toBe(125586);
 expect(rejected.find(r=>r.first[0]===3&&r.first[1]===102)?.solutions).toEqual([]);
});
