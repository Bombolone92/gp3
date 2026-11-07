import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { blockControlGroups } from '../src/engine/block-controls.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
vi.setConfig({ testTimeout: 60000 });
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/cell-controls.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const xml=b=>new DOMParser().parseFromString(strFromU8(unzipSync(b)['word/document.xml']),'application/xml');
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const controls=d=>blockControlGroups(d.paragraphs).filter(g=>g.control.kind==='cell');
it('reads six whole-cell controls, including spanning and empty cells, and preserves unrelated edits',async()=>{
 const pkg=await DocxPackage.open(source),d=model(pkg);expect(controls(d)).toHaveLength(6);
 expect(d.tables[0].rows.map(r=>r.cells.length)).toEqual([3,2,3]);
 expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
 d.select(0);d.replace('Before ');const bytes=await save(pkg,d),tree=xml(bytes);
 const wrappers=[...tree.getElementsByTagNameNS(W,'sdt')];expect(wrappers).toHaveLength(6);
 for(const wrapper of wrappers){expect(wrapper.parentElement.localName).toBe('tr');expect(wrapper.getElementsByTagNameNS(W,'sdtContent')[0].firstElementChild.localName).toBe('tc');}
 expectBodyEditParts(unzipSync(bytes),pkg.parts);
 expect(controls(model(await DocxPackage.open(bytes)))).toHaveLength(6);
 d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});
it('matches the native reference retaining a wrapper on formatting and removing it on text insertion',async()=>{
 const pkg=await DocxPackage.open(source),d=model(pkg),native=JSON.parse(readFileSync('tests/fixtures/cell-controls/native-edits.json'));
 expect(controls(d)).toHaveLength(native.before);
 const at=d.text.indexOf('Cell alpha');d.select(at,at+10);d.toggleBold();expect(controls(d)).toHaveLength(native.afterFormatting);
 d.select(at+4);d.replace('X');expect(controls(d)).toHaveLength(native.afterTextEdit);
 const bytes=await save(pkg,d);expect(xml(bytes).getElementsByTagNameNS(W,'sdt')).toHaveLength(5);
 const again=model(await DocxPackage.open(bytes));expect(again.text).toBe(d.text);expect(controls(again)).toHaveLength(5);
 d.undo();d.undo();expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});
it.each(['Cell beta',''])('replaces whole-cell placeholder %j without deleting the cell',async text=>{
 const pkg=await DocxPackage.open(source),d=model(pkg),before=d.text;
 const group=controls(d).find(g=>g.control.placeholder&&g.paragraphs.map(p=>p.runs.map(r=>r.text).join('')).join('\n')===text);
 d.select(group.start+(text?2:0));d.replace('Replacement');
 expect(d.tables[0].rows.map(r=>r.cells.length)).toEqual([3,2,3]);expect(controls(d)).toHaveLength(5);
 expect(d.text).toContain('Replacement');if(text)expect(d.text).not.toContain(text);
 const again=model(await DocxPackage.open(await save(pkg,d)));expect(again.text).toBe(d.text);
 d.undo();expect(d.text).toBe(before);expect(unzipSync(await save(pkg,d))).toEqual(unzipSync(source));
});
it.each(['multiple cells','locked'])('guards unsupported or malformed %s wrappers',async mode=>{
 const parts=unzipSync(source),tree=xml(source),s=tree.getElementsByTagNameNS(W,'sdt')[0];
 if(mode==='multiple cells'){const c=s.getElementsByTagNameNS(W,'sdtContent')[0];c.append(c.firstElementChild.cloneNode(true));}
 if(mode==='locked'){const n=tree.createElementNS(W,'w:lock');n.setAttributeNS(W,'w:val','sdtContentLocked');s.firstElementChild.append(n);}
 parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(tree));await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/content control/);
});
