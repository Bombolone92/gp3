// Native precision validator; nonzero on any independently captured mismatch.
// Native RGB values come from both a reference SaveAs and PDF, not this implementation.
import {readFileSync} from 'node:fs';
import {themeColorTransform} from '../src/engine/colors.js';
const cases=JSON.parse(readFileSync(new URL('../tests/fixtures/theme-color-precision/cases.json',import.meta.url)));
const refs=JSON.parse(readFileSync(new URL('../tests/fixtures/theme-color-precision/native-saved-colors.json',import.meta.url)));
let failures=0;
for(const [i,c]of cases.entries()){
 const expected=refs[i].attributes.val;
 if(refs[i].label!==c.label)throw new Error('Native reference order does not match cases');
 const actual=themeColorTransform(c.base,c.mode==='tint'?c.value/255:undefined,c.mode==='shade'?c.value/255:undefined);
 if(actual!==expected){failures++;console.log(`${c.label} ${c.base} ${c.mode} ${c.value}: expected ${expected}, actual ${actual}`);}
}
console.log(`${cases.length-failures}/${cases.length} native colors match; ${failures} unresolved`);
process.exitCode=Number(failures>0);
