import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/mixed-width-rounding/';
const r=JSON.parse(readFileSync(root+'reference.json'));
it('binds the 42 original rounding cases to the exact native sources',()=>{
 for(const [name,hash] of Object.entries(r.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 const cases=JSON.parse(readFileSync(root+'cases.json'));expect(r.rows).toHaveLength(42);
 expect(r.rows.map(({scope,width})=>({scope,width}))).toEqual(cases);
 expect(r.sourceSavedAfterRead).toBe(true);
});
it('retains nonmonotonic native automatic-column transitions and excess-width controls',()=>{
 const row=(scope,width)=>r.rows.find(x=>x.scope===scope&&x.width===width).widthTwips;
 expect(row('body',6001)).toEqual([3206,1923,436,436]);
 expect(row('body',6002)).toEqual([3205,1923,437,437]);
 expect(row('body',6003)).toEqual([3207,1924,436,436]);
 for(const width of [5999,6000,6001,6003])expect(row('all',width).reduce((a,b)=>a+b,0)).toBe(width+1);
});
