import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='tests/fixtures/theme-conversion-stages/';
const cases=JSON.parse(readFileSync(root+'cases.json'));
const reference=JSON.parse(readFileSync(root+'reference.json'));
it('binds native conversion-stage observations to the authored package and PDF',()=>{
 for(const[name,hash]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
 expect(reference.pages).toBe(3);expect(reference.referenceBuild).toBe('16.0.20326');
 expect(cases).toHaveLength(48);expect(reference.cases).toHaveLength(48);
 for(const [i,c]of cases.entries()){
  expect(reference.cases[i].label).toBe(c.label);
  expect(c.swatches.map(s=>s.kind)).toEqual(['srgb-modifier','hsl-modifier','hsl-result']);
  expect(reference.cases[i].swatches.map(({rgb,...s})=>s)).toEqual(c.swatches);
  for(const rgb of [reference.cases[i].wml,...reference.cases[i].swatches.map(s=>s.rgb)]){
   expect(rgb).toHaveLength(3);for(const channel of rgb){expect(Number.isInteger(channel)).toBe(true);expect(channel).toBeGreaterThanOrEqual(0);expect(channel).toBeLessThanOrEqual(255);}
  }
 }
});
it('preserves the independently captured WML results when equivalent DrawingML swatches are added',()=>{
 const originals=JSON.parse(readFileSync('tests/fixtures/theme-color-precision/cases.json'));
 const colors=JSON.parse(readFileSync('tests/fixtures/theme-color-precision/native-colors.json'));
 for(const c of reference.cases){
  const index=originals.findIndex(o=>o.base===c.base&&o.mode===c.mode&&o.value===c.value);
  expect(index).toBeGreaterThanOrEqual(0);expect(c.wml,`${c.base} ${c.mode} ${c.value}`).toEqual(colors[index].rgb);
 }
});
it('records the distinct native pipelines without certifying the unresolved renderer',()=>{
 const equal=(a,b)=>a.every((v,i)=>v===b[i]);
 for(let stage=0;stage<3;stage++)expect(reference.cases.filter(c=>equal(c.wml,c.swatches[stage].rgb))).toHaveLength(25);
 expect(reference.cases.filter(c=>equal(c.swatches[0].rgb,c.swatches[1].rgb))).toHaveLength(47);
 expect(reference.cases.filter(c=>equal(c.swatches[0].rgb,c.swatches[2].rgb))).toHaveLength(46);
});
