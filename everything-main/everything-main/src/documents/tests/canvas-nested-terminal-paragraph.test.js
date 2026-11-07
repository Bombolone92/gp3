import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument,caretRect} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const source=readFileSync('public/fixtures/nested-terminal-paragraph.docx');let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const measure=text=>({width:text.length*7,ascent:12,descent:4});
const layout=d=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables);
it('suppresses only an empty final paragraph directly following a nested table',async()=>{
 const p=await DocxPackage.open(source),l=layout(p);
 const baseline=text=>l.lines.find(l=>l.fragments.map(f=>f.text).join('')===text).baseline*.75;
 for(const [name,gap] of [['empty18',36],['empty36spacing',36],['text18',54],['twoempty',72],['spaces',54]])expect(baseline('After '+name)-baseline('Before '+name),name).toBeCloseTo(gap);
 expect(unzipSync(new Uint8Array(await p.export().arrayBuffer()))).toEqual(unzipSync(source));
});
it('retains an insertion position and stored spacing, restores allocation when typing, and exactly undoes the edit',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const at=d.paragraphs.findIndex(p=>p.cellId&&!p.runs.some(r=>r.text));d.select(d.paragraphOffset(at));
 const before=layout(d),line=before.lines.find(l=>l.paragraphId===d.paragraphs[at].id);expect(line.height).toBe(0);expect(caretRect(before,d.range[0]).height).toBeGreaterThan(0);
 const stored=structuredClone(d.paragraphs[at].format);d.replace('Typed ending');expect(layout(d).lines.find(l=>l.paragraphId===d.paragraphs[at].id).height).toBe(24);expect(d.paragraphs[at].format).toEqual(stored);
 const bytes=new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());expect(layout(await DocxPackage.open(bytes)).endY).toBe(layout(d).endY);
 d.undo();expect(layout(d)).toEqual(before);expect(unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()))).toEqual(unzipSync(source));
});
