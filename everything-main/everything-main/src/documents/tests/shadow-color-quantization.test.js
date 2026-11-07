import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/shadow-color-quantization/';
const ref=JSON.parse(readFileSync(root+'reference.json'));
it('binds all authored opacity controls to exact native captures',()=>{
 for(const[file,hash]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(root+file)).digest('hex'),file).toBe(hash);
 expect(ref.cases).toHaveLength(38);
 for(const r of ref.cases){expect(r.nativeImages).toHaveLength(2);expect(r.nativeImages[1].centerRgba).toEqual([0,0,0,255]);}
});
it('rejects float-alpha and low precision reciprocal hypotheses against native bytes',()=>{
 const matches=bits=>ref.cases.filter(r=>JSON.stringify(r.fixedReciprocalHypotheses[bits])===JSON.stringify(r.nativeImages[0].centerRgba)).length;
 expect(ref.cases.filter(r=>r.hypothesisMatches)).toHaveLength(20);
 expect(matches('8')).toBe(32);expect(matches('12')).toBe(35);
 expect(matches('16')).toBe(38);expect(matches('24')).toBe(38);
});
