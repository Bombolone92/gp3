import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {contentControlRanges} from '../src/engine/content-controls.js';
import {hyperlinkRanges,openableHyperlink} from '../src/engine/hyperlinks.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/control-hyperlinks.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const open=async()=>{const p=await DocxPackage.open(source);return[p,model(p)];};
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const choose=(d,text)=>{const at=d.text.indexOf(text);d.select(at,at+text.length);};
const links=d=>hyperlinkRanges(d.paragraphs).map(r=>[d.text?.slice(r.start,r.end),r.link.target,r.link.anchor,r.link.tooltip,r.link.history]);
const counts=d=>contentControlRanges(d.paragraphs).length;
const xml=b=>new DOMParser().parseFromString(strFromU8(unzipSync(b)['word/document.xml']),'application/xml');
const nodes=(d,n)=>[...d.getElementsByTagNameNS(W,n)];
const sameParts=(bytes,parts,except=[])=>{const out=unzipSync(bytes);expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort());for(const n of Object.keys(parts))if(!except.includes(n))expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
it('imports independent mixed controls with external/internal links and preserves untouched packages',async()=>{
 const[p,d]=await open();expect(counts(d)).toBe(3);expect(links(d)).toHaveLength(7);
 expect(links(d)[1]).toEqual(['Mail á😀','mailto:hello@example.com',undefined,'Write to us',true]);
 expect(links(d)[3][2]).toBe('Destination');choose(d,'Mail á😀');expect(d.clipboardText()).toBe('Mail á😀');sameParts(await save(p,d),p.parts);
});
it('retains nested link wrappers through partial formatting, run splits and repeated export/reopen',async()=>{
 const[p,d]=await open(),before=links(d);choose(d,'Mail');d.setRunFormat({bold:true,fontSize:15});choose(d,'Also');d.setRunFormat({italic:true});
 expect(counts(d)).toBe(3);const saved=await save(p,d),root=xml(saved);
 expect(nodes(root,'hyperlink')).toHaveLength(7);expect(nodes(nodes(root,'sdt')[0],'hyperlink')).toHaveLength(2);
 const again=model(await DocxPackage.open(saved));expect(links(again)).toEqual(before);expect(counts(again)).toBe(3);
 expect(again.paragraphs.flatMap(p=>p.runs).find(r=>r.text==='Mail')).toMatchObject({bold:true,fontSize:15,link:{target:'mailto:hello@example.com'}});
 sameParts(saved,p.parts,['word/document.xml']);d.undo();d.undo();sameParts(await save(p,d),p.parts);
});
it.each([
 ['target',d=>d.setHyperlink('https://example.com/changed')],
 ['unlink',d=>d.removeHyperlink()],
 ['text',d=>{d.select(d.range[0]+2);d.replace('X');}],
 ['split',d=>{d.select(d.range[0]+2);d.insertParagraph();}],
])('unwraps only the affected temporary control on %s changes and restores it with undo',async(_,edit)=>{
 const[p,d]=await open();choose(d,'Mail á😀');edit(d);expect(counts(d)).toBe(2);
 const bytes=await save(p,d),again=model(await DocxPackage.open(bytes));expect(links(again)).toEqual(links(d));expect(again.text).toBe(d.text);expect(counts(again)).toBe(2);
 expect(links(again).find(r=>r[0]==='Also mail')[1]).toBe('mailto:hello@example.com');d.undo();sameParts(await save(p,d),p.parts);
});
it('replaces a linked placeholder as a whole while preserving its destination',async()=>{
 const[p,d]=await open();choose(d,'[Email]');d.select(d.range[0]+2);d.replace('New text');expect(d.text).not.toContain('[Email]');expect(counts(d)).toBe(2);expect(links(d).find(r=>r[0]==='New text')[1]).toBe('mailto:hello@example.com');
 expect(model(await DocxPackage.open(await save(p,d))).text).toBe(d.text);d.undo();sameParts(await save(p,d),p.parts);
});
it('retains an unopenable link destination inside a control verbatim',async()=>{
 const parts=unzipSync(source);parts['word/_rels/document.xml.rels']=strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('mailto:hello@example.com','javascript:alert(1)'));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);expect(p.readOnly).not.toBe(true);
 const link=d.paragraphs.flatMap(q=>q.runs).find(r=>r.link?.target==='javascript:alert(1)').link;expect(link.retainedTarget).toBe(true);expect(openableHyperlink(link)).toBe(false);
 sameParts(await save(p,d),p.parts);
});
it.each(['missing','nested','empty','grapheme'])('rejects %s links inside controls before editing',async kind=>{
 const parts=unzipSync(source),root=xml(source),link=nodes(nodes(root,'sdt')[0],'hyperlink')[0];
 if(kind==='missing')link.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','r:id','absent');
 if(kind==='nested')link.append(link.cloneNode(true));
 if(kind==='empty')link.replaceChildren();
 if(kind==='grapheme'){link.replaceChildren();const r=root.createElementNS(W,'w:r'),t=root.createElementNS(W,'w:t');t.textContent='\u0301';r.append(t);link.append(r);}
 if(kind==='script')parts['word/_rels/document.xml.rels']=strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('mailto:hello@example.com','javascript:alert(1)'));
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(root));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});

it('does not extend a partial placeholder link across the expanded replacement range',async()=>{
 const parts=unzipSync(source),root=xml(source),pr=nodes(nodes(root,'sdt')[0],'sdtPr')[0];pr.insertBefore(root.createElementNS(W,'w:showingPlcHdr'),nodes(pr,'richText')[0]);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(root));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p);choose(d,'Mail á😀');d.select(d.range[0]+2);d.replace('Replacement');
 expect(d.text).not.toContain('Contact');expect(d.text).not.toContain('Web');expect(links(d).some(r=>r[0]==='Replacement')).toBe(false);
 expect(links(model(await DocxPackage.open(await save(p,d))))).toEqual(links(d));d.undo();sameParts(await save(p,d),p.parts);
});
