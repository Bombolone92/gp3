import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const evidence=JSON.parse(readFileSync('tests/fixtures/measurements/svg-two-pass-compositing.json'));
const premult=v=>[...v.slice(0,3).map(n=>Math.round(n*v[3]/255)),v[3]];
it('binds the two-pass diagnostic to retained native reference controls',()=>{
 const f='tests/fixtures/svg-external-backdrop/';
 expect(createHash('sha256').update(readFileSync(f+'native.emf')).digest('hex')).toBe(evidence.native.nativeSha256);
 expect(evidence.comparison.nativeSha256).toBe(evidence.native.nativeSha256);
 expect(evidence.native.pixelFormat).toBe('Format32bppPArgb');
 expect(evidence.native.samples).toHaveLength(24);
 expect(new Set(evidence.native.samples.map(s=>s.alpha))).toEqual(new Set([0,25,76,128,254,255]));
 for(const path of Object.values(evidence.comparison.paths)){
  expect(path.samples).toHaveLength(24);
  path.samples.forEach((s,i)=>{expect(s.alpha).toBe(evidence.native.samples[i].alpha);expect(s.background).toBe(evidence.native.samples[i].background);expect(premult(s.before)).toEqual(evidence.native.samples[i].beforePremult);});
 }
 expect(Object.values(evidence.comparison.routeHits)).toEqual([1,1,1]);
});
it('retains all exact native centers and distinguishes the unresolved production path',()=>{
 for(const scope of Object.values(evidence.opaque)){
  expect(scope.paths.composite.matches).toBe(36);
  expect(scope.paths.composite.colors).toEqual(scope.separateByteRounding);
  for(const mode of ['baseline','alpha','layers'])expect(scope.paths[mode].matches).toBe(28);
 }
 const native=evidence.native.samples.flatMap(s=>s.premultColors);
 expect(native).toHaveLength(216);
 const candidate=evidence.comparison.paths.composite.samples.flatMap(s=>s.colors.map(premult));
 const baseline=evidence.comparison.paths.baseline.samples.flatMap(s=>s.colors.map(premult));
 expect(candidate).toEqual(native);
 expect(baseline.filter((v,i)=>v.every((n,j)=>n===native[i][j]))).toHaveLength(121);
 expect(evidence.productionChanged).toBe(false);
});
