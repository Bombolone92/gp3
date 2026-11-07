import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/border-axis-phase/';
const ref=JSON.parse(readFileSync(folder+'screen-body-bands.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

it('binds all 1024 native body bands to the original control and independently captured screen pixels',()=>{
  expect(hash(readFileSync(folder+'control.docx'))).toBe(ref.sourceSha256);
  expect(ref.observations).toHaveLength(16);
  expect(new Set(ref.observations.map(o=>`${o.zoom}/${o.page}`)).size).toBe(16);
  expect(ref.observations.reduce((n,o)=>n+o.bands.length*2,0)).toBe(1024);
  for(const o of ref.observations){
    expect(hash(readFileSync(folder+o.crop))).toBe(o.cropSha256);
    expect(o.bands).toHaveLength(32);
    expect(new Set(o.bands.map(b=>`${b.id}/${b.axis}`)).size).toBe(32);
    for(const b of o.bands){
      expect(b.positions).toHaveLength(2);
      const base=b.axis==='h'?b.region[1]:b.region[0],extent=b.axis==='h'?b.region[3]:b.region[2];
      expect(b.positions.every(([a,z])=>a>=base&&z<=base+extent)).toBe(true);
      expect(b.positions.map(([a,z])=>z-a)).toEqual(b.widths);
      expect(b.widths.every(w=>w>0)).toBe(true);
    }
  }
});

it('rejects a constant three-pixel bottom body despite constant top and vertical widths at 100 percent',()=>{
  const wide=ref.observations.filter(o=>o.zoom===100).flatMap(o=>o.bands).filter(b=>b.borderSize===18);
  expect(new Set(wide.filter(b=>b.axis==='h').map(b=>b.widths[0]))).toEqual(new Set([3]));
  expect(new Set(wide.filter(b=>b.axis==='v').flatMap(b=>b.widths))).toEqual(new Set([3]));
  expect(new Set(wide.filter(b=>b.axis==='h').map(b=>b.widths[1]))).toEqual(new Set([2,3]));
  const first=ref.observations.find(o=>o.zoom===100&&o.page===5).bands.find(b=>b.id===1&&b.axis==='h');
  expect(first.positions).toEqual([[24,27],[56,58]]);
  expect(first.widths).toEqual([3,2]);
});

it('keeps quarter-point bodies at one pixel and wide bodies at six pixels in the observed 200 percent controls',()=>{
  const thin=ref.observations.flatMap(o=>o.bands).filter(b=>b.borderSize===2);
  expect(new Set(thin.flatMap(b=>b.widths))).toEqual(new Set([1]));
  const wide=ref.observations.filter(o=>o.zoom===200).flatMap(o=>o.bands).filter(b=>b.borderSize===18);
  expect(new Set(wide.flatMap(b=>b.widths))).toEqual(new Set([6]));
});
