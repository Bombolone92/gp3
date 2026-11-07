import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const folder='tests/fixtures/cell-next-context', refs=JSON.parse(readFileSync(`${folder}/reference.json`)), cases=JSON.parse(readFileSync(`${folder}/cases.json`));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
it('retains independently recorded source and native reference PDF hashes',()=>{for(const ref of Object.values(refs))for(const[n,h]of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${n}`)).digest('hex')).toBe(h);});
it('matches same-cell, next-cell and row-boundary suppression and updates after style editing',async()=>{
 const source=readFileSync(`${folder}/control.docx`),p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const heights=(doc=d)=>{const cells=layout(doc).cells;return doc.tables.map(t=>cells.find(c=>c.id===t.rows[0].cells[0].id).height*.75);};
 const before=heights();
 for(const c of cases){const suppressed=c.context&&(c.rowbreak?c.current==='Normal':c.current===c.nextstyle);expect(before[c.index],JSON.stringify(c)).toBeCloseTo(suppressed?28:36,6);}
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const original=unzipSync(source),same=unzipSync(await save());for(const n of Object.keys(original))expect(Buffer.from(same[n]).equals(Buffer.from(original[n])),n).toBe(true);
 d.selectCell(d.tables[1].rows[0].cells[1].id);d.setParagraphStyle('Other');expect(heights()[1]).toBeCloseTo(36,6);
 const edited=await save(),reopened=await DocxPackage.open(edited);expect(heights(reopened)).toEqual(heights());
 const out=unzipSync(edited);for(const n of Object.keys(original))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(original[n])),n).toBe(true);
 d.undo();expect(heights()).toEqual(before);const undo=unzipSync(await save());for(const n of Object.keys(original))expect(Buffer.from(undo[n]).equals(Buffer.from(original[n])),n).toBe(true);
});
it('respects allowSpaceOfSameStyleInTable for every cell boundary',async()=>{
 const p=await DocxPackage.open(readFileSync(`${folder}/control.docx`));p.pageSettings.allowSpaceOfSameStyleInTable=true;
 const cells=layout(p).cells;for(const t of p.tables)expect(cells.find(c=>c.id===t.rows[0].cells[0].id).height*.75).toBeCloseTo(36,6);
});
