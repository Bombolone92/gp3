import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';

const folder='tests/fixtures/svg-cubic-range/',hash=b=>createHash('sha256').update(b).digest('hex');
const cases=JSON.parse(readFileSync(folder+'cases.json')),apiCases=JSON.parse(readFileSync(folder+'api-cases.json'));
const ref=JSON.parse(readFileSync(folder+'metafile-reference.json'));
const api=JSON.parse(readFileSync(folder+'native-api.json','utf8').replace(/^\uFEFF/,''));

it('binds the authored range controls to a read-only reference capture and native API input',()=>{
 for(const [name,key]of [['control.docx','sourceSha256'],['cases.json','casesSha256'],['capture.emf','captureSha256'],['capture.json','captureMetadataSha256'],['native.emf','nativeSha256']])expect(hash(readFileSync(folder+name)),name).toBe(ref[key]);
 const metadata=JSON.parse(readFileSync(folder+'capture.json','utf8').replace(/^\uFEFF/,''));
 expect(metadata.sourceUnchanged).toBe(true);expect(metadata.captureReadOnly).toBe(true);expect(metadata.savedBefore).toBe(true);expect(metadata.savedAfter).toBe(true);
 expect(hash(readFileSync(folder+'api-cases.json'))).toBe(api.inputSha256);
 expect(api.quantizeInput).toBe(true);expect(api.tolerance).toBe(.25);
 expect(api.cases.map(c=>c.name)).toEqual(apiCases.map(c=>c.name));
 expect(cases).toHaveLength(16);expect(apiCases).toHaveLength(24);expect(ref.images).toHaveLength(16);
 const svg=new TextDecoder().decode(unzipSync(readFileSync(folder+'control.docx'))['word/media/vector.svg']);
 for(const c of cases)expect(svg).toContain(`d="${c.path}"`);
 for(const im of ref.images){const png=readFileSync(folder+im.path);expect(hash(png)).toBe(im.sha256);expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual(im.size);}
});

it('full and half-curve controls describe the same cubic without geometry compensation',()=>{
 const at=(p,t)=>p[0].map((_,k)=>(1-t)**3*p[0][k]+3*(1-t)**2*t*p[1][k]+3*(1-t)*t*t*p[2][k]+t**3*p[3][k]);
 for(let i=0;i<cases.length;i+=2){
  const whole=cases[i],halves=cases[i+1];expect(whole.height).toBe(halves.height);
  const shift=halves.points[0][0]-whole.points[0][0];
  for(let tick=0;tick<=64;tick++){
   const t=tick/64,part=t<=.5?0:1,local=part===0?2*t:2*t-1;
   const actual=at(halves.segments[part],local);actual[0]-=shift;
   expect(actual,`${whole.name}:${t}`).toEqual(at(whole.points,t));
  }
 }
});

it('retains the native whole/split discontinuity as evidence without requiring incorrect renderer pixels',()=>{
 const count=name=>api.cases.find(c=>c.name===name).points.length/2;
 expect(count('h511/whole/0')).toBe(83);expect(count('h511.5/whole/0')).toBe(51);
 expect(count('h511.5/split/0')+count('h511.5/split/1')-1).toBe(83);
 for(const c of api.cases){expect(c.points.length%2).toBe(0);expect(c.points.every(Number.isFinite)).toBe(true);}
});
