import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('keeps overflow border geometry, clips each cell fragment, and preserves edits and undo',async()=>{
 const pkg=await DocxPackage.open(readFileSync('public/fixtures/paragraph-border-overflow.docx'));
 const d=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const layout=()=>layoutDocument(d.paragraphs,t=>({width:t.length*6,ascent:10,descent:3}),pageGeometry(d.pageSettings),d.numbering,d.tables);
 const save=async()=>new Uint8Array(await pkg.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const before=layout();expect(before.pageCount).toBe(1);expect(before.paragraphBorders).toHaveLength(12);
 for(const stroke of before.paragraphBorders){const c=before.cells.find(c=>c.id===stroke.cellId);expect(stroke.cellClip).toEqual({left:c.x,right:c.x+c.width,top:c.y,bottom:c.y+c.height});}
 const edge=before.paragraphBorders.find(s=>s.side==='left');expect(edge.x).toBeLessThan(edge.cellClip.left);
 expect(unzipSync(await save())).toEqual(pkg.parts);
 d.select(0);d.setParagraphFormat({indentLeft:400});const edited=await save();
 expect((await DocxPackage.open(edited)).paragraphs[0].format.indentLeft).toBe(400);
 d.undo();expect(layout()).toEqual(before);expect(unzipSync(await save())).toEqual(pkg.parts);
});
