import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/theme-shade-sweep/',cases=JSON.parse(readFileSync(root+'cases.json')),ref=JSON.parse(readFileSync(root+'reference.json'));
it('binds all shade-byte controls to the exact native source and checks full domain coverage',()=>{
 for(const [name,key]of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['native.pdf','pdfSha256']])expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(ref[key]);
 expect(cases).toHaveLength(512);expect(ref.colors).toHaveLength(512);expect(ref.pages).toBe(15);
 for(const base of ['4F81BD','C0504D'])expect(cases.filter(c=>c.base===base&&c.mode==='shade').map(c=>c.value)).toEqual(Array.from({length:256},(_,i)=>i));
 for(const [i,c]of cases.entries()){expect(ref.colors[i].label).toBe(c.label);expect(ref.colors[i].rgb).toHaveLength(3);for(const v of ref.colors[i].rgb){expect(Number.isInteger(v)).toBe(true);expect(v).toBeGreaterThanOrEqual(0);expect(v).toBeLessThanOrEqual(255);}}
});

it('native maxima contradict any fixed saturation with exact lightness and final floor',()=>{
 const observed=(base,value)=>{
  const index=cases.findIndex(c=>c.base===base&&c.mode==='shade'&&c.value===value);
  expect(index).toBeGreaterThanOrEqual(0);
  return Math.max(...ref.colors[index].rgb);
 };
 for(const [base,lowerByte,upperByte] of [['4F81BD',72,4],['C0504D',226,4]]){
  const channels=[...Buffer.from(base,'hex')], sum=Math.min(...channels)+Math.max(...channels);
  const lowerMax=observed(base,lowerByte),upperMax=observed(base,upperByte);
  // Compare (qLower*510)/(sum*kLower)-1 against
  // ((qUpper+1)*510)/(sum*kUpper)-1 without floating-point rounding.
  expect(lowerMax*upperByte).toBeGreaterThanOrEqual((upperMax+1)*lowerByte);
  expect(sum*lowerByte).toBeLessThan(255*255); // both use the dark-output branch
  expect(sum*upperByte).toBeLessThan(255*255);
 }
});
