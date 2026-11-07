import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
const root='tests/fixtures/script-input-context/';
const cases=JSON.parse(readFileSync(root+'cases.json','utf8'));
const recording=JSON.parse(readFileSync(root+'native-recording.json','utf8'));
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function paragraphs(name){
 const parts=unzipSync(readFileSync(root+name));
 const dom=new JSDOM(strFromU8(parts['word/document.xml']),{contentType:'text/xml'});
 const enabled=(r,key)=>{const node=r.getElementsByTagNameNS(W,key)[0];return !!node&&!['0','false','off'].includes(node.getAttributeNS(W,'val'));};
 const result=[...dom.window.document.getElementsByTagNameNS(W,'p')].map(p=>[...p.getElementsByTagNameNS(W,'r')].flatMap(r=>{
  const text=[...r.children].map(n=>n.localName==='t'?n.textContent:n.localName==='tab'?'\t':'').join('');
  return [...text].map(text=>({text,cs:enabled(r,'cs'),rtl:enabled(r,'rtl')}));
 }));dom.window.close();return result;
}
it('binds every sequential native operation to exact text, paragraph counts and recorded source/output',()=>{
 expect(recording.caseCount).toBe(252);expect(cases).toHaveLength(recording.caseCount);
 for(const [name,hash]of Object.entries(recording.hashes))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex')).toBe(hash);
 const source=paragraphs('control.docx'),native=paragraphs('native.docx');expect(source).toHaveLength(cases.length);
 let at=0;
 for(const c of cases){
  const expected=('A'+c.steps.join('')+'B').split('\n');
  expect(native.slice(at,at+expected.length).map(p=>p.map(r=>r.text).join(''))).toEqual(expected);at+=expected.length;
 }
 expect(at).toBe(native.length);expect(source.every(p=>p.map(r=>r.text).join('')==='AB')).toBe(true);
});
it('records the native distinction between batch and sequential complex-script numeric input',()=>{
 const native=paragraphs('native.docx');let at=0;const observed=[];
 for(const c of cases){observed.push(native[at]);at+=c.steps.join('').split('\n').length;}
 const get=(steps)=>observed[cases.findIndex(c=>c.flag==='cs'&&!c.inherited&&JSON.stringify(c.steps)===JSON.stringify(steps))].slice(1,-1);
 expect(get(['क','1',' '])).toEqual([{text:'क',cs:true,rtl:false},{text:'1',cs:true,rtl:false},{text:' ',cs:true,rtl:false}]);
 expect(get(['क1 '])).toEqual([{text:'क',cs:true,rtl:false},{text:'1',cs:false,rtl:false},{text:' ',cs:false,rtl:false}]);
 expect(get(['क',' ','A'])).toEqual([{text:'क',cs:true,rtl:false},{text:' ',cs:true,rtl:false},{text:'A',cs:false,rtl:false}]);
 expect(get(['क','  A'])).toEqual([{text:'क',cs:true,rtl:false},{text:' ',cs:false,rtl:false},{text:' ',cs:false,rtl:false},{text:'A',cs:false,rtl:false}]);
});
