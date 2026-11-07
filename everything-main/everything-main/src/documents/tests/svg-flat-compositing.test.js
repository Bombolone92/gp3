import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const directory='tests/fixtures/svg-external-backdrop/';
const reference=JSON.parse(readFileSync(directory+'native-colors.json','utf8').replace(/^\uFEFF/,''));
// Integer arithmetic: nearest byte division has no half tie with denominator
// 255. Allow every legal premultiplied source RGB, not only authored colors.
const roundByte=n=>Math.floor((n+127)/255);
function flatSolutions(row){
 const solutions=[];
 for(let alpha=0;alpha<=255;alpha++){
  const source=[0,1,2].map(channel=>reference.samples.map(sample=>{
   const backdrop=parseInt(sample.background.slice(channel*2,channel*2+2),16);
   return sample.colors[row][channel]-roundByte(backdrop*(255-alpha));
  }));
  if(source.every(values=>values.every(n=>n===values[0])&&values[0]>=0&&values[0]<=alpha))
   solutions.push({alpha,premultiplied:source.map(values=>values[0])});
 }
 return solutions;
}
describe('native external-backdrop samples cannot all be flattened to one byte RGBA image',()=>{
 it('binds the colors to the independent reference capture and four rendered backdrops',()=>{
  for(const [name,hash] of Object.entries(reference.hashes))
   expect(createHash('sha256').update(readFileSync(directory+name)).digest('hex'),name).toBe(hash);
  expect(reference.samples.map(s=>s.background)).toEqual(['FFFFFF','F2F2F2','808080','202020']);
 });
 it('recovers exactly one legal premultiplied pixel for every isolated fill',()=>{
  expect(Array.from({length:8},(_,row)=>flatSolutions(row))).toEqual([
   [{alpha:25,premultiplied:[6,13,19]}],[{alpha:76,premultiplied:[19,38,57]}],
   [{alpha:25,premultiplied:[9,15,14]}],[{alpha:76,premultiplied:[27,44,44]}],
   [{alpha:25,premultiplied:[25,20,16]}],[{alpha:76,premultiplied:[76,62,47]}],
   [{alpha:25,premultiplied:[16,12,8]}],[{alpha:76,premultiplied:[50,38,25]}],
  ]);
 });
 it('finds no alpha or RGB tuple for the overlap across all four backdrops',()=>{
  expect(flatSolutions(8)).toEqual([]);
  // A single replacement bitmap plus destination-out/lighter cannot retain
  // the measured per-layer rounding, even with freely chosen source colors.
  expect(reference.samples.map(s=>s.colors[8])).toEqual([
   [246,229,212],[238,221,204],[166,149,132],[104,88,70],
  ]);
 });
});
