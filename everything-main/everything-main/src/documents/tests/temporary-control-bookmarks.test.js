import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage,W} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {contentControlRanges} from '../src/engine/content-controls.js';
import {assertPackageParts} from './helpers/assert-package-parts.js';
const root='tests/fixtures/temporary-control-bookmarks/',source=readFileSync(root+'control.docx');
const refs=JSON.parse(readFileSync(root+'native-results.json','utf8').replace(/^\uFEFF/,''));
const names=['interior','boundary','point','hyperlink','crossing','placeholder','placeholder_inner','placeholder_crossing','placeholder_overlap'];
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>dom.window.close());
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const paragraph=(bytes,i)=>{const x=new DOMParser().parseFromString(strFromU8(unzipSync(bytes)['word/document.xml']),'application/xml');return [...x.getElementsByTagNameNS(W,'body')[0].children].filter(n=>n.localName==='p')[i];};
const markerScopes=p=>[...p.getElementsByTagName('*')].filter(n=>['bookmarkStart','bookmarkEnd'].includes(n.localName)).map(n=>{
 let owner=n.parentElement;while(owner!==p&&owner.localName!=='sdt')owner=owner.parentElement;
 return {edge:n.localName,inside:owner!==p};
});
const bold=n=>{const b=n?.getElementsByTagNameNS(W,'b')[0];return !!b&&!['false','0','off'].includes(b.getAttributeNS(W,'val'));};
const styledText=p=>[...p.getElementsByTagNameNS(W,'r')].flatMap(r=>[...[...r.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('')].map(c=>[c,bold(r)]));
it('binds the original and native captures to exact repository bytes',()=>{
 for(const[name,hash]of Object.entries(JSON.parse(readFileSync(root+'manifest.json'))))expect(createHash('sha256').update(readFileSync(root+name)).digest('hex'),name).toBe(hash);
});
for(const ref of refs.cases)it(`matches the native reference ${ref.action} with ${ref.name} bookmarks`,async()=>{
 const p=await DocxPackage.open(source),d=model(p),index=names.indexOf(ref.name),range=contentControlRanges(d.paragraphs)[index];
 assertPackageParts(unzipSync(await save(p,d)),unzipSync(source));
 if(ref.action==='format'){d.select(range.start+1,range.start+3);d.toggleBold();}
 if(ref.action==='insert'){d.select(range.start+4);d.replace('X');}
 if(ref.action==='delete-bookmark')d.removeBookmark(d.bookmarks.find(b=>b.name==='Mark_'+ref.name).id);
 const bytes=await save(p,d),reopened=model(await DocxPackage.open(bytes));
 const current=reopened.paragraphs[index];expect(contentControlRanges([current])).toHaveLength(ref.controls);
 const bookmark=reopened.bookmarks.find(b=>b.name==='Mark_'+ref.name);
 if(ref.bookmark===null)expect(bookmark).toBeUndefined();
 else{expect(bookmark).toBeTruthy();expect(reopened.text.slice(bookmark.start,bookmark.end)).toBe(ref.bookmark.text||'');}
 // The reference UI selects placeholder prompts as a unit. Its automation-only partial
 // Range.Font edit is a no-op, so compare the saved UI operation for prompts.
 const nativeFile=ref.action==='format'&&ref.name.startsWith('placeholder')?'placeholder-format-native.docx':ref.action+'-native.docx';
 const native=paragraph(readFileSync(root+nativeFile),index),actual=paragraph(bytes,index);
 expect(markerScopes(actual)).toEqual(markerScopes(native));
 if(ref.action==='format'){
  expect(styledText(actual)).toEqual(styledText(native));
  expect(bold(actual.getElementsByTagNameNS(W,'sdtPr')[0])).toBe(bold(native.getElementsByTagNameNS(W,'sdtPr')[0]));
 }
 expect([...actual.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join('')).toBe([...native.getElementsByTagNameNS(W,'t')].map(n=>n.textContent).join(''));
 const parts=unzipSync(bytes);for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(parts[n]).equals(Buffer.from(b)),n).toBe(true);
 if(ref.action!=='baseline'){d.undo();assertPackageParts(unzipSync(await save(p,d)),unzipSync(source));}
});
it('retains boundary markers inside an untouched control when neighboring paragraph text changes',async()=>{
 const p=await DocxPackage.open(source),d=model(p),r=contentControlRanges(d.paragraphs)[1];d.select(r.start-2);d.replace('Z');
 const bytes=await save(p,d);expect(markerScopes(paragraph(bytes,1))).toEqual([{edge:'bookmarkStart',inside:true},{edge:'bookmarkEnd',inside:true}]);
 expect(contentControlRanges(model(await DocxPackage.open(bytes)).paragraphs)).toHaveLength(names.length);
});
it('still rejects malformed bookmark markers within temporary controls',async()=>{
 const parts=unzipSync(source);parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace('w:bookmarkStart w:id="0"','w:bookmarkStart w:unknown="x" w:id="0"'));
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/bookmark/);
});
