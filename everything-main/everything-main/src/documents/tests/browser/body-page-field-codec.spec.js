import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';

test('preserves field envelopes with native browser DOM serialization',async({page},info)=>{
 await page.goto('/playground.html');
 const original=unzipSync(readFileSync('tests/fixtures/body-page-fields/control.docx'));
 const records=JSON.parse(readFileSync('tests/fixtures/body-page-fields/native-edits.json','utf8').replace(/^\uFEFF/,''));
 for(const record of records.cases.filter(c=>c.name!=='split')){
  const result=await page.evaluate(async({xml,text})=>{
   const {pageFieldSegments,writePageFieldResult}=await import('/src/engine/docx-page-fields.js');
   const w='http://schemas.openxmlformats.org/wordprocessingml/2006/main',doc=new DOMParser().parseFromString(xml,'application/xml');
   const p=[...doc.getElementsByTagNameNS(w,'p')].find(p=>pageFieldSegments(p).some(s=>s.field));
   const segments=pageFieldSegments(p),field=segments.find(s=>s.field),run=field.resultNodes[0].cloneNode(true);
   run.getElementsByTagNameNS(w,'t')[0].textContent=text??'';
   const nodes=segments.flatMap(s=>s.node?[s.node.cloneNode(true)]:writePageFieldResult(s.field,text?[run]:[],doc));
   p.replaceChildren(p.firstElementChild,...nodes);
   const serialized=new XMLSerializer().serializeToString(doc),again=new DOMParser().parseFromString(serialized,'application/xml');
   const fields=[...again.getElementsByTagNameNS(w,'p')].flatMap(p => pageFieldSegments(p)).filter(s=>s.field);
   return {xml:serialized,count:fields.length,text:fields[0].resultNodes.map(n=>n.textContent).join(''),code:fields[0].field.instruction};
  },{xml:strFromU8(original['word/document.xml']),text:record.firstResult});
  expect(result.count).toBe(record.fieldCount);expect(result.text).toBe(record.firstResult??'');expect(result.code.trim()).toBe(record.firstCode.trim());
  const parts={...original,'word/document.xml':strToU8(result.xml)};
  writeFileSync(info.outputPath(record.name+'.docx'),zipSync(parts));
 }
});
