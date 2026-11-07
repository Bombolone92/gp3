// Diagnostic only: reports unresolved input-context differences without changing guards.
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const dom=new JSDOM('');globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
const root=new URL('../tests/fixtures/script-input-context/',import.meta.url);
const cases=JSON.parse(readFileSync(new URL('cases.json',root),'utf8'));
const source=await DocxPackage.open(readFileSync(new URL('control.docx',root)),{bestEffort:true});
const native=await DocxPackage.open(readFileSync(new URL('native.docx',root)),{bestEffort:true});
const flags=p=>p.runs.flatMap(r=>Array(r.text.length).fill([!!r.cs,!!r.rtl]));
const marks=p=>[!!p.markFormat?.cs,!!p.markFormat?.rtl,p.markFormat?.fontSize,p.markFormat?.fontSizeCs];
let at=0;const differences=[];
for(const [index,c]of cases.entries()){
 const doc=new TextDocument([source.paragraphs[index]]);doc.select(1);
 for(const step of c.steps)doc.replace(step);
 const count=1+c.steps.join('').split('\n').length-1;
 const np=native.paragraphs.slice(at,at+count);at+=count;
 const actual=doc.paragraphs.map(flags),expected=np.map(flags);
 const actualMarks=doc.paragraphs.map(marks),expectedMarks=np.map(marks);
 if(JSON.stringify(actual)!==JSON.stringify(expected)||JSON.stringify(actualMarks)!==JSON.stringify(expectedMarks))differences.push({index,...c,actual,expected,actualMarks,expectedMarks});
}

console.log(JSON.stringify({cases:cases.length,mismatches:differences.length,flagMismatches:differences.filter(d=>JSON.stringify(d.actual)!==JSON.stringify(d.expected)).length,differences}));
dom.window.close();
