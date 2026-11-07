import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/thin-border-crossing/';
const ref=JSON.parse(readFileSync(folder+'reference.json'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

it('binds independently captured thin crossings to the unchanged original control and source positions',()=>{
  const bytes=readFileSync(folder+'control.docx');
  expect(hash(bytes)).toBe(ref.sourceSha256);expect(ref.ownedSourceSha256).toBe(ref.sourceSha256);
  expect(hash(readFileSync(folder+'cases.json'))).toBe(ref.casesSha256);expect(ref.savedAtBothCaptures).toBe(true);
  expect(ref.observations.map(o=>o.zoom)).toEqual([100,200]);
  const parts=Object.keys(unzipSync(bytes));
  expect(parts.some(p=>/fonts|media|embeddings/.test(p))).toBe(false);
  for(const o of ref.observations){
    expect(hash(readFileSync(folder+o.crop))).toBe(o.cropSha256);expect(o.rows).toHaveLength(12);
    expect(new Set(o.rows.map(r=>r.id)).size).toBe(12);
    for(const r of o.rows){
      expect(r.positions.vertical[1]-r.positions.vertical[0]).toBe(1);
      expect(r.positions.horizontal[1]-r.positions.horizontal[0]).toBe(1);
      expect(r.crossing).toEqual([r.positions.vertical[0],r.positions.horizontal[0]]);
      expect(r.owner).toBe(r.rgb[0]>r.rgb[2]?'vertical':'horizontal');
    }
  }
});

it('native crossing ownership follows unequal authored widths and horizontal equal-width priority',()=>{
  const cases=JSON.parse(readFileSync(folder+'cases.json'));
  for(const o of ref.observations)for(const r of o.rows){
    const c=cases.find(c=>c.id===r.id);
    expect(r.owner).toBe(c.verticalSize>c.horizontalSize?'vertical':'horizontal');
  }
  // At 100%, the half-point interior vertical pen is left of its rounded
  // writing centerline. Sampling the old centerline would query horizontal ink.
  expect(ref.observations[0].rows[0].crossing).toEqual([71,48]);
  expect(ref.observations[0].rows[0].owner).toBe('vertical');
  expect(ref.observations[1].rows[0].crossing).toEqual([144,96]);
});
