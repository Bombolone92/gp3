import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {bodyFieldRanges} from '../src/engine/body-fields.js';
import {bodyFieldInstruction} from '../src/engine/docx-body-fields.js';
import {pageFieldInstruction} from '../src/engine/docx-page-fields.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const source=readFileSync('public/fixtures/toc-pageref.docx');
const native=JSON.parse(readFileSync('tests/fixtures/toc-pageref/native-edits.json','utf8').replace(/^\uFEFF/,''));
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const results=d=>bodyFieldRanges(d.paragraphs).map(r=>({code:r.field.instruction,result:d.text.slice(r.start,r.end)}));
const xml=out=>new DOMParser().parseFromString(strFromU8(unzipSync(out)['word/document.xml']),'application/xml');

it('binds native edits to the exact source and leaves page-story evaluators strict',()=>{
 expect(native.sourceSha256).toBe(createHash('sha256').update(source).digest('hex'));
 expect(bodyFieldInstruction(' TOC \\o "1-3" \\t "Heading 1,1,Appendix,2" \\h ')).toMatchObject({type:'TOC'});
 expect(bodyFieldInstruction(' PAGEREF "Named target" \\h \\p ')).toMatchObject({type:'PAGEREF',bookmark:'Named target'});
 expect(()=>bodyFieldInstruction('PAGEREF \\h')).toThrow('bookmark');
 expect(()=>bodyFieldInstruction('TOC \\o "unterminated')).toThrow('argument');
 expect(()=>bodyFieldInstruction('MACROBUTTON NoMacro Label')).toThrow();
 expect(()=>pageFieldInstruction('PAGEREF Topic1')).toThrow('unsupported page field');
});

it.each(native.cases)('matches the native reference cached TOC edit $name, including native XML import',async ref=>{
 const p=await DocxPackage.open(source),d=model(p),ranges=bodyFieldRanges(d.paragraphs),toc=ranges[0],page=ranges[1];
 expect(ranges).toHaveLength(5);expect(d.text.slice(toc.start,toc.end)).toBe(ref.before.replaceAll('\r','\n'));
 if(ref.name==='entry'){d.select(toc.start,toc.start+'First topic'.length);d.replace('Manual entry');}
 if(ref.name==='page'||ref.name==='empty-page'){d.select(page.start,page.end);d.replace(ref.name==='page'?'7':'');}
 if(ref.name==='heading'){const at=d.text.lastIndexOf('First topic\n');d.select(at,at+'First topic'.length);d.replace('Renamed heading');}
 if(ref.name==='split-entry'){d.select(toc.start+5);d.replace('\n');}
 const current=bodyFieldRanges(d.paragraphs)[0];expect(d.text.slice(current.start,current.end)).toBe(ref.result.replaceAll('\r','\n'));
 const out=await save(p,d),again=model(await DocxPackage.open(out));expect(again.text).toBe(d.text);expect(results(again)).toEqual(results(d));
 expect(bodyFieldRanges(again.paragraphs)).toHaveLength(5);
 const links=[...xml(out).getElementsByTagNameNS(W,'hyperlink')].filter(n=>n.getElementsByTagNameNS(W,'fldChar').length);
 expect(links).toHaveLength(3);for(const link of links)expect([...link.getElementsByTagNameNS(W,'fldChar')].map(n=>n.getAttributeNS(W,'fldCharType'))).toEqual(['begin','separate','end']);
 for(const[name,bytes]of Object.entries(p.parts))if(name!=='word/document.xml')expect(unzipSync(out)[name]).toEqual(bytes);
 const parts=unzipSync(source),doc=xml(source);doc.documentElement.replaceChild(doc.importNode(new DOMParser().parseFromString(ref.documentXml,'application/xml').documentElement,true),doc.getElementsByTagNameNS(W,'body')[0]);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 const fromWord=model(await DocxPackage.open(zipSync(parts)));expect(results(fromWord).filter(r=>!/^\s*HYPERLINK\b/.test(r.code))).toEqual(results(d));expect(fromWord.text).toBe(d.text);
 const nativeLinks=bodyFieldRanges(fromWord.paragraphs).filter(r=>r.field.type==='HYPERLINK');
 expect(nativeLinks).toHaveLength(ref.name==='split-entry'?1:0);
 if(nativeLinks.length){expect(nativeLinks[0].field.resultLink.anchor).toBe('Topic1');expect(fromWord.text.slice(nativeLinks[0].start,nativeLinks[0].end)).toBe('First\n topic\t2');}
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

for(const fixture of ['toc-pageref','toc-pageref-formatting','toc-hyperlink-style'])
it(`${fixture}: preserves field envelopes, formatting, targets and exact undo`,async()=>{
 const p=await DocxPackage.open(readFileSync(`public/fixtures/${fixture}.docx`)),d=model(p),toc=bodyFieldRanges(d.paragraphs)[0];
 expect(unzipSync(await save(p,d))).toEqual(p.parts);
 d.select(toc.start+1);d.replace('X');const again=model(await DocxPackage.open(await save(p,d)));
 expect(again.text).toBe(d.text);expect(results(again)).toEqual(results(d));expect(again.bookmarks.map(b=>b.name)).toEqual(['Topic1','Topic2','Topic3']);
 const entry=again.paragraphs[1].runs.find(r=>r.text.includes('topic'));
 expect(entry.link.anchor).toBe('Topic1');
 if(fixture==='toc-hyperlink-style')expect(entry).toMatchObject({tocHyperlink:true,italic:false,fontSize:12});
 if(fixture==='toc-pageref-formatting')expect(entry).toMatchObject({italic:true,fontSize:16,color:'7030A0'});
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('retains an empty standalone field hyperlink and its external relationship',async()=>{
 const parts=unzipSync(source),doc=xml(source),para=[...doc.getElementsByTagNameNS(W,'p')][5],link=doc.createElementNS(W,'w:hyperlink');
 link.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','r:id','external');
 for(const r of [...para.children].slice(2))link.append(r);para.append(link);
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));
 parts['word/_rels/document.xml.rels']=strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('</Relationships>','<Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/field" TargetMode="External"/></Relationships>'));
 const p=await DocxPackage.open(zipSync(parts)),d=model(p),r=bodyFieldRanges(d.paragraphs).at(-1);
 d.select(r.start,r.end);d.replace('');const out=await save(p,d),again=model(await DocxPackage.open(out)),end=bodyFieldRanges(again.paragraphs).at(-1);
 expect(end.start).toBe(end.end);expect(end.startLink.target).toBe('https://example.com/field');expect(end.endLink.target).toBe(end.startLink.target);
 expect(xml(out).getElementsByTagNameNS(W,'hyperlink').length).toBe(4);
 again.select(end.start);again.replace('9');expect(model(await DocxPackage.open(await save(p,again))).text).toBe(again.text);
});

it.each(['remove','retarget'])('updates field-boundary hyperlinks when a user chooses %s',async action=>{
 const p=await DocxPackage.open(source),d=model(p),r=bodyFieldRanges(d.paragraphs)[1];d.select(r.start);
 if(action==='remove')d.removeHyperlink();else d.setHyperlink({anchor:'Topic2'});
 const out=await save(p,d),again=model(await DocxPackage.open(out)),field=bodyFieldRanges(again.paragraphs)[1];
 expect(field.startLink?.anchor).toBe(action==='remove'?undefined:'Topic2');expect(field.endLink?.anchor).toBe(field.startLink?.anchor);
 expect(results(again)).toEqual(results(d));d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('recomputes TOC style suppression when changing style or deleting the enclosing field',async()=>{
 const p=await DocxPackage.open(readFileSync('public/fixtures/toc-hyperlink-style.docx')),d=model(p),toc=bodyFieldRanges(d.paragraphs)[0];
 d.select(toc.start,toc.start+'First topic'.length);d.setCharacterStyle('Entry');
 expect(d.paragraphs[1].runs.find(r=>r.text==='First topic')).toMatchObject({italic:true,fontSize:16,color:'7030A0'});
 expect(d.paragraphs[1].runs.find(r=>r.text==='First topic').tocHyperlink).toBeUndefined();
 expect(model(await DocxPackage.open(await save(p,d))).paragraphs[1].runs.find(r=>r.text==='First topic')).toMatchObject({italic:true,fontSize:16});
 d.undo();d.select(toc.start,toc.end+1);d.replace('Replacement');
 const run=d.paragraphs.flatMap(p=>p.runs).find(r=>r.text==='Replacement');expect(run.tocHyperlink).toBeUndefined();
 const again=model(await DocxPackage.open(await save(p,d)));expect(again.text).toBe(d.text);expect(again.paragraphs.flatMap(p=>p.runs).find(r=>r.text==='Replacement')).toMatchObject({italic:run.italic,fontSize:run.fontSize,color:run.color});
 d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});

it('keeps PAGEREF codes and explicit hyperlink boundaries in sync with a bookmark rename',async()=>{
 const p=await DocxPackage.open(source),d=model(p),bookmark=d.bookmarks.find(b=>b.name==='Topic1');
 d.renameBookmark(bookmark.id,'RenamedTopic');const again=model(await DocxPackage.open(await save(p,d))),field=bodyFieldRanges(again.paragraphs)[1];
 expect(field.field.instruction).toBe(' PAGEREF RenamedTopic \\h ');expect(field.startLink.anchor).toBe('RenamedTopic');expect(field.endLink.anchor).toBe('RenamedTopic');
 expect(d.text).toBe(again.text);d.undo();expect(unzipSync(await save(p,d))).toEqual(p.parts);
});
