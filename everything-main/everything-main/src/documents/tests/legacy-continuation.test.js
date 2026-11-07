import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const ref=JSON.parse(readFileSync('tests/fixtures/legacy-continuation/reference.json'));
it('binds native continuation controls and preserves identical standalone advances',()=>{
 for(const[file,hash]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(file)).digest('hex'),file).toBe(hash);
 expect(ref.pairs.map(p=>p.style)).toEqual(['regular','bold']);
 for(const p of ref.pairs){
  expect(p.wrappedAdvances).toHaveLength(p.text.length);
  expect(p.wrappedAdvances).toEqual(p.standaloneAdvances);
  expect(p.originX).toBe(0);expect(p.font.face).toBe('Open Sans');
 }
});
