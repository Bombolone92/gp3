import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {contentControlRanges} from '../src/engine/content-controls.js';
import {blockControlGroups} from '../src/engine/block-controls.js';
const source=readFileSync('tests/fixtures/docpart-object/control.docx');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const shells=d=>[...blockControlGroups(d.paragraphs),...contentControlRanges(d.paragraphs)].sort((a,b)=>a.start-b.start).map(r=>r.control.shell);
it('edits saved block and inline building blocks while retaining their metadata',async()=>{
 const p=await DocxPackage.open(source),d=model(p),original=shells(d);expect(original).toHaveLength(4);
 expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));
 for(const text of ['Alpha','Beta','Gamma','Delta']){const at=d.text.indexOf(text);d.select(at,at+text.length);d.replace(text+' edited');}
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));
 expect(reopened.text).toBe(d.text);
 const properties=ss=>ss.map(s=>{const xml=new DOMParser().parseFromString(s,'application/xml');return new XMLSerializer().serializeToString(xml.getElementsByTagNameNS(W,'sdtPr')[0]);});
 expect(properties(shells(reopened))).toEqual(properties(original));
 for(const[n,b]of Object.entries(unzipSync(source)))if(n!=='word/document.xml')expect(unzipSync(bytes)[n]).toEqual(b);
 while(d.history.length)d.undo();expect(unzipSync(await save(p,d))).toEqual(unzipSync(source));
});
const variants=[
 ['duplicate','<w:docPartGallery w:val="A"/><w:docPartGallery w:val="B"/>'],
 ['unknown','<w:unknown/>'],['missing value','<w:docPartCategory/>'],
 ['invalid boolean','<w:docPartUnique w:val="maybe"/>'],
 ['nested','<w:docPartCategory w:val="A"><w:docPartUnique/></w:docPartCategory>'],
];
it.each(variants)('guards malformed document-part metadata: %s',async(_,xml)=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace(/<w:docPartObj>.*?<\/w:docPartObj>/,`<w:docPartObj>${xml}</w:docPartObj>`));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/content controls/);
});
it('rejects conflicting content types',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('<w:docPartObj>','<w:text/><w:docPartObj>'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/conflicting content types/);
});
it('retains document-part ordering and independently recorded native edits',async()=>{
 const bytes=readFileSync('tests/fixtures/docpart-object/native-edited.xml');
 const reference=JSON.parse(readFileSync('tests/fixtures/docpart-object/native-edit-reference.json','utf8').replace(/^\uFEFF/,''));
 const hash=b=>createHash('sha256').update(b).digest('hex');
 expect(hash(source)).toBe(reference.sourceSha256);expect(hash(bytes)).toBe(reference.xmlSha256);
 const native=new DOMParser().parseFromString(bytes.toString(),'application/xml');
 const controls=[...native.getElementsByTagNameNS(W,'sdt')];expect(controls).toHaveLength(4);
 for(const [i,text]of ['Alpha','Beta','Gamma','Delta'].entries())expect(controls[i].textContent).toContain(text+' edited');
 const obj=native.getElementsByTagNameNS(W,'docPartObj')[0];
 expect([...obj.children].map(e=>e.localName)).toEqual(['docPartGallery','docPartUnique','docPartCategory']);
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');
 const target=xml.getElementsByTagNameNS(W,'docPartObj')[0];target.replaceWith(xml.importNode(obj,true));
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);d.select(d.text.indexOf('Alpha'),d.text.indexOf('Alpha')+5);d.replace('Edited');
 const saved=unzipSync(await save(p,d));
 const out=new DOMParser().parseFromString(strFromU8(saved['word/document.xml']),'application/xml');
 expect([...out.getElementsByTagNameNS(W,'docPartObj')[0].children].map(e=>e.localName)).toEqual(['docPartGallery','docPartUnique','docPartCategory']);
});
