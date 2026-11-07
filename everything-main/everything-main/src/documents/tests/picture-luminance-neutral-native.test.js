import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/picture-luminance-neutral/';
const ref=JSON.parse(readFileSync(root+'reference.json','utf8'));
it('binds the neutral-effect observations to the original source and native PDF',()=>{
 for(const [name,hash] of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 expect(ref.pages).toBe(1);expect(ref.rows).toHaveLength(9);
 expect(ref.rows.every(r=>r.samples.length===16)).toBe(true);
});
it('distinguishes neutral bypass from rounding introduced by nonzero luminance',()=>{
 for(const row of ref.rows.slice(1,4))expect(row.samples).toEqual(ref.rows[0].samples);
 expect(ref.rows[0].samples[12].imageRGB).toEqual([100,20,40]);
 expect(ref.rows[4].samples[12].imageRGB).toEqual([99,19,39]);
 expect(ref.rows[5].samples[12].imageRGB).toEqual([98,18,38]);
 expect(ref.rows[8].samples[12].imageRGB).toEqual([128,50,70]);
 for(const row of ref.rows)expect(row.samples[12].alpha).toBe(128);
});
