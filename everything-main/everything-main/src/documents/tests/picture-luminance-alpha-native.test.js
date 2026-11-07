import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/picture-luminance-alpha/';
const ref=JSON.parse(readFileSync(root+'reference.json','utf8'));
it('binds the full-alpha observations to their source and native PDF',()=>{
 for(const [name,hash] of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 expect(ref.pages).toBe(1);expect(ref.rows).toHaveLength(9);
 for(const row of ref.rows){expect(row.samples).toHaveLength(256);expect(row.samples.map(s=>s[3])).toEqual(Array.from({length:256},(_,i)=>i));expect(row.matte).toEqual([0,0,0]);}
});
it('preserves every neutral sample but exposes alpha-dependent nonzero rounding',()=>{
 for(const row of ref.rows.slice(1,4))expect(row.samples).toEqual(ref.rows[0].samples);
 expect(ref.rows[4].samples[127]).toEqual([99,19,39,127]);
 expect(ref.rows[4].samples[128]).toEqual([99,19,39,128]);
 expect(ref.rows[4].samples[129]).toEqual([100,19,39,129]);
 expect(ref.rows[8].samples[127]).toEqual([126,50,70,127]);
 expect(ref.rows[8].samples[128]).toEqual([128,50,70,128]);
});
