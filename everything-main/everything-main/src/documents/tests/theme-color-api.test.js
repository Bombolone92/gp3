import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const folder='tests/fixtures/theme-color-precision/';
const api=JSON.parse(readFileSync(folder+'native-api-colors.json','utf8'));
const cases=JSON.parse(readFileSync(folder+'cases.json','utf8'));
const colors=JSON.parse(readFileSync(folder+'native-saved-colors.json','utf8'));
const manifest=JSON.parse(readFileSync(folder+'manifest.json','utf8'));
it('native API observations belong to the independent precision control',()=>{
  expect(createHash('sha256').update(readFileSync('public/fixtures/theme-color-precision.docx')).digest('hex')).toBe(api.sourceSha256);
  expect(api.rows.map(row=>row.label)).toEqual(cases.map(row=>row.label));
  expect(api.rows).toHaveLength(128);
  for(const name of ['cases.json','native-saved-colors.json'])expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex')).toBe(manifest.sha256[name]);
  for(const row of api.rows){expect(Number.isInteger(row.rgbProperty)).toBe(true);expect(row.rgbProperty).toBeLessThan(0);expect(row.type).toBe(2);}
});
it('equal ColorFormat tint/shade getters cannot substitute for native rendered colors',()=>{
  for(const labels of [['C112','C113'],['C120','C121']]){
    const rows=labels.map(label=>api.rows.find(row=>row.label===label));
    expect(rows[0].tintAndShade).toBe(rows[1].tintAndShade);
    const native=labels.map(label=>colors.find(row=>row.label===label).attributes.val);
    expect(native[0]).not.toBe(native[1]);
  }
});
