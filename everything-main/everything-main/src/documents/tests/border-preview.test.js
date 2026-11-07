import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const root='tests/fixtures/border-preview/',source=readFileSync(root+'control.docx');
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
it('retains independent source and native references',()=>{
 const ref=JSON.parse(readFileSync(root+'reference.json')),hash=n=>createHash('sha256').update(readFileSync(root+n)).digest('hex');
 expect(hash('control.docx')).toBe(ref.sourceSha256);expect(hash('plain.docx')).toBe(ref.plainSha256);expect(hash('native.pdf')).toBe(ref.pdfSha256);
});
it.each(['handmade1','apples','single-shadow'])('omits only unsupported %s borders in read-only preview',async kind=>{
 const parts=unzipSync(source);
 if(kind!=='handmade1')parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replaceAll('w:val="handmade1"',kind==='apples'?'w:val="apples"':'w:val="single" w:shadow="1"'));
 const bytes=zipSync(parts);await expect(DocxPackage.open(bytes)).rejects.toMatchObject({name:'UnsupportedDocumentError'});
 const p=await DocxPackage.open(bytes,{bestEffort:true}),plain=await DocxPackage.open(readFileSync(root+'plain.docx'));
 expect(p.readOnly).toBe(true);expect(()=>p.export()).toThrow(/read-only/);
 const borderMetadata={borders:{},display:'allPages',offsetFrom:'page',zOrder:'front'};
 expect(p.pageSettings).toEqual({...plain.pageSettings,pageBorders:borderMetadata});
 const sections=x=>x.paragraphs.filter(p=>p.sectionEnd).map(p=>p.sectionEnd);
 expect(sections(p)).toEqual(sections(plain).map(s=>({...s,pageBorders:borderMetadata})));expect(sections(p)).toHaveLength(1);
 const measure=t=>({width:t.length*7,ascent:12,descent:3}),layout=p=>layoutDocument(p.paragraphs,measure,pageGeometry(p.pageSettings),p.numbering,p.tables);
 const a=layout(p),b=layout(plain);expect(a.pages).toEqual(b.pages.map(g=>({...g,pageBorders:borderMetadata})));
 expect(a.lines.map(l=>[l.page,l.y,l.height,l.width])).toEqual(b.lines.map(l=>[l.page,l.y,l.height,l.width]));
 for(const[n,b]of Object.entries(parts))expect(Buffer.from(p.parts[n]).equals(Buffer.from(b)),n).toBe(true);
});
