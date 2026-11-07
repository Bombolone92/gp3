import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/line-separator-fonts/';
const ref=JSON.parse(readFileSync(root+'reference.json','utf8'));
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
it('binds the independent separator observations to the native source and PDF bytes',()=>{
 for(const [name,hash] of Object.entries(ref.sha256))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 expect(ref.pages).toBe(8);expect(ref.rows.map(r=>r.case)).toEqual(cases.map(c=>c[0]));
 expect(ref.rows.map(r=>r.page)).toEqual([1,2,3,4,5,6,7,8]);
});
it('records fallback-dependent metrics rather than treating the separator as an ordinary space',()=>{
 const rows=Object.fromEntries(ref.rows.map(r=>[r.case,r]));
 expect(rows.space.baselines).toEqual(rows.none.baselines);
 expect(rows.arial.baselines[1]-rows.none.baselines[1]).toBeCloseTo(.60,2);
 expect(rows.arial.baselines[2]-rows.none.baselines[2]).toBeCloseTo(1.44,2);
 expect(rows.large.baselines[2]).toBeGreaterThan(rows.arial.baselines[2]);
 for(const [id,font] of [['arial','MS-Gothic'],['arial-east','MS Mincho'],['courier','MS Mincho'],['times','TimesNewRomanPSMT'],['calibri','MS-Gothic']])expect(rows[id].fonts.some(f=>f.endsWith('+'+font)),id).toBe(true);
});
