import {assertPackageParts} from './helpers/assert-package-parts.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {projectRetainedTextBoxControls} from '../src/engine/docx-content-controls.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const source=readFileSync('tests/fixtures/retained-textbox-controls/control.docx');
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const drawings=bytes=>{const xml=new DOMParser().parseFromString(strFromU8(bytes),'application/xml');return [...xml.getElementsByTagNameNS(W,'drawing')].map(n=>[...n.getElementsByTagName('*')].map(e=>[e.namespaceURI,e.localName,[...e.attributes].filter(a=>a.namespaceURI!=='http://www.w3.org/2000/xmlns/').map(a=>[a.namespaceURI,a.localName,a.value]).sort(),e.children.length?'':e.textContent]));};
it('renders saved drawing control text while preserving controls through body edits, export and undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),original=unzipSync(source);
 const texts=[];const walk=n=>{if(n.text)texts.push(n.text.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n'));n.children?.forEach(walk);};Object.values(p.assets).filter(a=>a.scene).forEach(a=>walk(a.scene));expect(texts).toEqual(Array.from({length:6},(_,i)=>`Saved label ${i+1}`));
 const save=async()=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
 assertPackageParts(await save(),original);d.select(0);d.replace('Edited ');const edited=await save();expect(drawings(edited['word/document.xml'])).toEqual(drawings(original['word/document.xml']));
 expectBodyEditParts(edited,original);
 const reopened=await DocxPackage.open(zipSync(edited));expect(reopened.paragraphs[0].runs.map(r=>r.text).join('')).toMatch(/^Edited /);
 d.undo();assertPackageParts(await save(),original);
});
it.each(['missing-content','duplicate-content','unknown-child','unsupported-block'])('guards invalid retained drawing contents: %s',async kind=>{
 const parts=unzipSync(source),xml=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml'),sdt=xml.getElementsByTagNameNS(W,'sdt')[0],content=sdt.getElementsByTagNameNS(W,'sdtContent')[0];
 if(kind==='missing-content')content.remove();if(kind==='duplicate-content')sdt.append(content.cloneNode(true));if(kind==='unknown-child')sdt.append(xml.createElementNS(W,'w:unknown'));if(kind==='unsupported-block')content.append(xml.createElementNS(W,'w:tbl'));
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(xml));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
it('does not project editable body controls through the retained-textbox entry point',()=>{const root=new DOMParser().parseFromString(`<w:document xmlns:w="${W}"/>`,'application/xml').documentElement;expect(()=>projectRetainedTextBoxControls(root)).toThrow(/outside a retained text box/);});
