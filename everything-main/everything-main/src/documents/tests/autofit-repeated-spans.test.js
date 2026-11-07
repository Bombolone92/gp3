import {beforeAll, afterAll, it, expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
const folder='tests/fixtures/autofit-repeated-spans', source=readFileSync(`${folder}/control.docx`);
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const layout=d=>layoutDocument(d.paragraphs,(t,s)=>({width:t.length*s.fontSize/2,ascent:s.fontSize,descent:s.fontSize/4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
it('retains independently authored source and native reference hashes',()=>{
  for(const[n,h]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${n}`)).digest('hex')).toBe(h);
});
it('keeps repeated span requests idempotent and independent of their position',async()=>{
  const p=await DocxPackage.open(source), l=layout(p), widths=Object.values(l.tableWidths);
  expect(widths).toHaveLength(8);
  for(const row of widths)for(const[i,w]of row.entries())expect(w).toBeCloseTo(widths[0][i],6);
});
it('reflows long cell edits, preserves preferences on export and restores exact layout and parts on undo',async()=>{
  const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),before=layout(d);
  const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  const start=d.text.indexOf('C03 column 0');d.select(start,start+'C03 column 0'.length);d.replace('W'.repeat(18));
  expect(layout(d).tableWidths[d.tables[3].id]).not.toEqual(before.tableWidths[d.tables[3].id]);
  const edited=await save(),reopened=await DocxPackage.open(edited),out=unzipSync(edited),parts=unzipSync(source);
  expect(Object.values(layout(reopened).tableWidths)).toEqual(Object.values(layout(d).tableWidths));
  expect(reopened.tables.map(t=>t.grid)).toEqual(p.tables.map(t=>t.grid));
  for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);
  d.undo();expect(layout(d)).toEqual(before);const undo=unzipSync(await save());
  for(const n of Object.keys(parts))expect(Buffer.from(undo[n]).equals(Buffer.from(parts[n])),n).toBe(true);
});
