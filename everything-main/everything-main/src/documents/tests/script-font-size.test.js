import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {reducedScriptSize} from '../src/engine/script-font-size.js';

const matrix=JSON.parse(readFileSync('tests/fixtures/script-size/reference.json'));
for(const c of matrix.cases){
 const f=matrix.fonts[c.family][['regular','bold','italic'].indexOf(c.face)];
 for(const r of c.rows)it(`matches native size: ${c.family} ${c.face} ${r.size}pt ${r.script}`,()=>{
  const size=reducedScriptSize(r.size,r.script,{unitsPerEm:f.unitsPerEm,scriptMetrics:f.os2ScriptMetrics});
  expect(Math.abs(size-r.nativeSize)).toBeLessThan(.061);
 });
}
const controls=JSON.parse(readFileSync('tests/fixtures/script-metric-controls/reference.json'));
for(const f of controls.pages)for(const script of ['superscript','subscript'])it(`matches independent metric variation: ${f.font} ${script}`,()=>{
 const size=reducedScriptSize(20,script,{unitsPerEm:f.unitsPerEm,scriptMetrics:f.os2ScriptMetrics});
 expect(Math.abs(size-f[script].size)).toBeLessThan(.061);
});
it('keeps unavailable, variable and invalid metrics on the existing rendering path',()=>{
 const metadata={unitsPerEm:1000,scriptMetrics:[650,650,0,75,650,650,0,350]};
 expect(reducedScriptSize(12,'superscript',null)).toBeNull();
 expect(reducedScriptSize(12,'superscript',{...metadata,variable:true})).toBeNull();
 expect(reducedScriptSize(0,'superscript',metadata)).toBeNull();
 expect(reducedScriptSize(12,'superscript',{...metadata,scriptMetrics:[650,650,0,75,650,0,0,350]})).toBeNull();
});
