import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {pageFieldSegments,pageFieldValue,writePageFieldResult} from '../src/engine/docx-page-fields.js';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const source=readFileSync('tests/fixtures/body-page-fields/control.docx');
const native=JSON.parse(readFileSync('tests/fixtures/body-page-fields/native-results.json','utf8').replace(/^\uFEFF/,''));
let dom,segments;
beforeAll(()=>{
 dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 const xml=new DOMParser().parseFromString(strFromU8(unzipSync(source)['word/document.xml']),'application/xml');
 segments=[...xml.getElementsByTagNameNS(W,'p')].flatMap(p => pageFieldSegments(p)).filter(s=>s.field);
});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('retains the native body caches on open and repagination',()=>{
 expect(createHash('sha256').update(source).digest('hex').toUpperCase()).toBe(native.sourceSha256);
 expect(native.pages).toBe(3);expect(native.updateResult).toBe(0);expect(segments).toHaveLength(15);
 for(const stage of native.stages.filter(s=>s.stage!=='update'))expect(segments.map(s=>s.resultNodes.map(n=>n.textContent).join(''))).toEqual(stage.fields.map(f=>f.result));
});
it('matches explicit native updates through section restarts, totals, formats and locks',()=>{
 const updated=native.stages.find(s=>s.stage==='update').fields;
 for(const [i,s] of segments.entries()){
  const context={pageNumber:i<7?1:i<10?2:7,pageCount:3,sectionPageCount:i<10?2:1,pageNumbering:{format:i<10?'decimal':'upperRoman'}};
  const actual=pageFieldValue(s.field,context)??s.resultNodes.map(n=>n.textContent).join('');
  expect(actual,`field ${i+1}: ${s.field.instruction}`).toBe(updated[i].result);
 }
});
it('records distinct instruction, MERGEFORMAT and simple-field update formatting',()=>{
 const fields=native.stages.find(s=>s.stage==='update').fields;
 const properties=i=>{
  const root=new DOMParser().parseFromString(fields[i].resultXml,'application/xml');
  const r=[...root.getElementsByTagNameNS(W,'r')].find(r=>r.getElementsByTagNameNS(W,'t').length);
  return [...r.getElementsByTagNameNS(W,'rPr')[0].children].map(n=>[n.localName,n.getAttributeNS(W,'val')]);
 };
 expect(properties(0)).toContainEqual(['i',null]);expect(properties(0)).toContainEqual(['sz','22']);
 expect(properties(1)).toContainEqual(['b',null]);expect(properties(1)).toContainEqual(['sz','28']);
 expect(properties(2).some(([name])=>['b','i','sz'].includes(name))).toBe(false);
 expect(properties(4)).toContainEqual(['b',null]);expect(properties(4)).toContainEqual(['sz','28']);
});
it.each(['insert','replace','delete-all','format'])('writes native %s results without dropping the field envelope',name=>{
 const records=JSON.parse(readFileSync('tests/fixtures/body-page-fields/native-edits.json','utf8').replace(/^\uFEFF/,''));
 expect(records.sourceSha256).toBe(native.sourceSha256);
 const expected=records.cases.find(c=>c.name===name);expect(expected.error).toBeNull();expect(expected.fieldCount).toBe(15);
 const doc=new DOMParser().parseFromString(`<w:p xmlns:w="${W}"/>`,'application/xml'),p=doc.documentElement;
 const result=doc.createElementNS(W,'w:r'),t=doc.createElementNS(W,'w:t');t.textContent=expected.firstResult;result.append(t);
 if(name==='format'){const pr=doc.createElementNS(W,'w:rPr');pr.append(doc.createElementNS(W,'w:i'));result.prepend(pr);}
 const original=segments[0].field,sourceBefore=original.source;
 p.append(...writePageFieldResult(original,expected.firstResult?[result]:[],doc));
 const [again]=pageFieldSegments(p);expect(again.field.instruction).toBe(original.instruction);
 // The reference automation API returns null for an empty Result.Text range.
 expect(again.resultNodes.map(n=>n.textContent).join('')).toBe(expected.firstResult??'');
 expect(original.source).toBe(sourceBefore);expect(result.parentNode).toBeNull();
 if(name==='format')expect(again.resultNodes[0].getElementsByTagNameNS(W,'i')).toHaveLength(1);
});
it('preserves simple-field attributes and complex lock flags when rewriting results',()=>{
 const doc=new DOMParser().parseFromString(`<w:p xmlns:w="${W}"/>`,'application/xml');
 const r=doc.createElementNS(W,'w:r'),t=doc.createElementNS(W,'w:t');t.textContent='Changed';r.append(t);
 for(const index of [2,4]){
  const original=segments[index].field;pReplace(writePageFieldResult(original,[r],doc));
  const [again]=pageFieldSegments(doc.documentElement);expect(again.field.locked).toBe(original.locked);expect(again.field.dirty).toBe(original.dirty);expect(again.field.instruction).toBe(original.instruction);
  if(index===2)expect(doc.documentElement.firstElementChild.localName).toBe('fldSimple');
 }
 function pReplace(nodes){doc.documentElement.replaceChildren(...nodes);}
});
it('creates a separator for an uncached complex field and rejects a mismatched envelope',()=>{
 const doc=new DOMParser().parseFromString(`<w:p xmlns:w="${W}"><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>PAGE</w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>`,'application/xml');
 const field=pageFieldSegments(doc.documentElement)[0].field;
 const result=doc.createElementNS(W,'w:r'),t=doc.createElementNS(W,'w:t');t.textContent='7';result.append(t);
 doc.documentElement.replaceChildren(...writePageFieldResult(field,[result],doc));
 expect(pageFieldSegments(doc.documentElement)[0].resultNodes.map(n=>n.textContent).join('')).toBe('7');
 expect([...doc.getElementsByTagNameNS(W,'fldChar')].map(n=>n.getAttributeNS(W,'fldCharType'))).toEqual(['begin','separate','end']);
 expect(()=>writePageFieldResult({...field,instruction:'NUMPAGES'},[],doc)).toThrow('envelope');
});
