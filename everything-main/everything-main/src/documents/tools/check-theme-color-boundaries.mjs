// Native boundary validator; nonzero on any independently captured mismatch.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {themeColorTransform} from '../src/engine/colors.js';
const root=process.argv[2]?pathToFileURL(resolve(process.argv[2])+sep):new URL('../tests/fixtures/theme-color-boundaries/',import.meta.url);
const read=name=>readFileSync(new URL(name,root));
const source=process.argv[3]||'control.docx';
const cases=JSON.parse(read('cases.json'));
const reference=JSON.parse(read('reference.json'));
for(const [name,key]of [[source,'sourceSha256'],['native.pdf','pdfSha256'],['cases.json','casesSha256']]){
 if(createHash('sha256').update(read(name)).digest('hex')!==reference[key])throw new Error(`Native reference hash mismatch: ${name}`);
}
if(cases.length!==reference.colors.length)throw new Error('Native case count mismatch');
let failures=0;
for(const [i,c]of cases.entries()){
 const ref=reference.colors[i];
 if(ref.label!==c.label)throw new Error('Native reference order mismatch');
 const expected=ref.rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();
 const actual=themeColorTransform(c.base,c.mode==='tint'?c.value/255:undefined,c.mode==='shade'?c.value/255:undefined);
 if(actual!==expected){failures++;console.log(`${c.label} ${c.base} ${c.mode} ${c.value}: expected ${expected}, actual ${actual}`);}
}
console.log(`${cases.length-failures}/${cases.length} native colors match; ${failures} unresolved`);
process.exitCode=Number(failures>0);
