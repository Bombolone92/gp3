import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {svgOpacityFloat} from '../src/engine/svg-group-opacity.js';
import {nativeSvgAlpha} from '../src/engine/svg-native-opacity.js';
const folder='tests/fixtures/svg-vector-opacity-precision/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
for(const [file,hash] of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(folder+file)).digest('hex')).toBe(hash);
const cases=JSON.parse(readFileSync(folder+'cases.json'));

it('retains all native inline ARGB records in authored shape order',()=>{
 const bytes=readFileSync(folder+'native.emf'),colors=[];
 for(let pos=0;pos<bytes.length;){
  const kind=bytes.readUInt32LE(pos),size=bytes.readUInt32LE(pos+4);
  expect(size).toBeGreaterThanOrEqual(8);expect(pos+size).toBeLessThanOrEqual(bytes.length);
  if(kind===70)for(let at=pos+16;at<pos+size;){
   const type=bytes.readUInt16LE(at),flags=bytes.readUInt16LE(at+2),length=bytes.readUInt32LE(at+4),count=bytes.readUInt32LE(at+8);
   expect(length).toBeGreaterThanOrEqual(12);expect(at+length).toBeLessThanOrEqual(pos+size);
   if(type===0x4014){expect(flags&0x8000).toBe(0x8000);expect(count).toBe(4);const color=bytes.readUInt32LE(at+12);colors.push({alpha:color>>>24,rgb:(color&0xffffff).toString(16).padStart(6,'0').toUpperCase()});}
   at+=length;
  }
  pos+=size;
 }
 expect(colors).toHaveLength(379);expect(ref.rows).toHaveLength(380);
 expect(ref.rows.filter(r=>!r.omitted).map(({alpha,rgb})=>({alpha,rgb}))).toEqual(colors);
 expect(ref.rows[64].omitted).toBe(true);expect(cases[32].value).toBe('0.0');
});

it('lower adjacent Float32 explains all 256 native byte-fraction controls',()=>{
 const values=cases.slice(32,288).map(c=>Number(c.value));
 expect(values).toHaveLength(256);
 expect(values.map(v=>Math.floor(svgOpacityFloat(v)*255))).toEqual(ref.rows.slice(64,320).map(r=>r.alpha));
});

it('equivalent authored rectangle/path paints have identical native ARGB',()=>{
 const rows=ref.rows.slice(332);expect(rows).toHaveLength(48);
 for(let i=0;i<rows.length;i+=2)expect([rows[i].alpha,rows[i].rgb]).toEqual([rows[i+1].alpha,rows[i+1].rgb]);
 expect(rows.map(r=>r.alpha)).toEqual(Array(6).fill([50,50,101,101,152,152,203,203]).flat());
});

it.fails('pending vector alpha correction: current helper matches native byte fractions',()=>{
 expect(cases.slice(32,288).map(c=>Math.round(nativeSvgAlpha(Number(c.value),1)*255)))
  .toEqual(ref.rows.slice(64,320).map(r=>r.alpha));
});
