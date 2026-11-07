import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
it('retains full-channel native CMYK grid and independent holdout observations',()=>{
 const root='tests/fixtures/cmyk-color-grid/',reference=JSON.parse(readFileSync(root+'reference.json')),cases=JSON.parse(readFileSync(root+'cases.json'));
 for(const[name,hash]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 const captures=unzipSync(readFileSync(root+'native-metafiles.zip'));
 expect(cases).toHaveLength(48);expect(reference.samples.grid).toHaveLength(625);expect(reference.samples.holdout).toHaveLength(128);
 for(const[index,group]of cases.entries()){
  const data=Buffer.from(captures[`${index+1}.emf`]),samples=[];
  for(let p=0;p<data.length;){
   const type=data.readUInt32LE(p),size=data.readUInt32LE(p+4);expect(size).toBeGreaterThanOrEqual(8);expect(p+size).toBeLessThanOrEqual(data.length);
   if(type===81){
    const bmi=p+data.readUInt32LE(p+48),bits=p+data.readUInt32LE(p+56),bpp=data.readUInt16LE(bmi+14);
    expect(data.readUInt32LE(bmi)).toBe(40);expect(data.readInt32LE(bmi+4)).toBe(256);expect(data.readInt32LE(bmi+8)).toBe(128);expect(data.readUInt32LE(bmi+16)).toBe(0);
    expect([1,4,8]).toContain(bpp);const stride=Math.ceil(256*bpp/32)*4;
    samples.push(group.colors.map((cmyk,i)=>{const x=i%4*64+32,y=127-(Math.floor(i/4)*32+16),byte=data[bits+y*stride+Math.floor(x*bpp/8)],color=(byte>>(8-bpp-x*bpp%8))&((1<<bpp)-1),at=bmi+40+4*color;return {cmyk,rgb:[data[at+2],data[at+1],data[at]]};}));
   }
   p+=size;
  }
  expect(samples).toEqual([reference.samples[group.set].slice(group.start,group.start+group.colors.length)]);
 }
 // This rejected candidate must not accidentally become a passing fidelity claim.
 expect(reference.maxInterpolationError).toBe(20);expect(reference.worseThanNaive).toBe(0);
});
