import {it,expect,beforeAll,afterAll} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DocxPackage} from '../src/engine/docx.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
import {TextDocument} from '../src/engine/model.js';
import {unzipSync} from 'fflate';
const folder='tests/fixtures/autofit-picture-preferences/';
const reference=JSON.parse(readFileSync(folder+'reference.json','utf8'));
let dom,pkg,layout;
beforeAll(async()=>{
 dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
 pkg=await DocxPackage.open(readFileSync(folder+'control.docx'));
 layout=layoutDocument(pkg.paragraphs,(t,s)=>({width:t.length*s.fontSize*.6,ascent:s.fontSize,descent:s.fontSize*.25}),pageGeometry(pkg.pageSettings),pkg.numbering,pkg.tables);
});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('binds the independently authored control to its native reference measurements',()=>{
 for(const [name,hash] of Object.entries(reference.sha256))expect(createHash('sha256').update(readFileSync(folder+name)).digest('hex'),name).toBe(hash);
 expect(layout.pageCount).toBe(8);
});
it.each(reference.cases)('uses $preference width for a $pictureWidthPt pt picture',ref=>{
 const cell=layout.cells[ref.id];
 expect(Math.abs(cell.x*.75-ref.left)).toBeLessThan(.2);
 expect(Math.abs(cell.width*.75-ref.width)).toBeLessThan(.2);
 const line=layout.lines.find(l=>l.cellId===cell.id&&l.fragments.some(f=>f.image));
 expect(line.fragments.find(f=>f.image).width*.75).toBeCloseTo(ref.pictureWidthPt,5);
 if(ref.pictureWidthPt===504&&ref.preference!=='dxa')expect(line.cellClip.right).toBeCloseTo(cell.x+cell.width,5);
 if(ref.preference==='dxa')expect(line.cellClip).toBeUndefined();
});
it('reflows when the width preference is edited, survives export, and restores the original package on undo',async()=>{
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const width=()=>layoutDocument(doc.paragraphs,(t,s)=>({width:t.length*s.fontSize*.6,ascent:s.fontSize,descent:s.fontSize*.25}),pageGeometry(doc.pageSettings),doc.numbering,doc.tables).cells[0].width*.75;
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 doc.selectCell(doc.tables[0].rows[0].cells[0].id);
 doc.setTableProperties({width:{type:'dxa',value:5760}});
 expect(Math.abs(width()-reference.cases[2].width)).toBeLessThan(.2);
 const edited=await save(),reopened=await DocxPackage.open(edited);
 expect(reopened.tables[0].width).toEqual({type:'dxa',value:5760});
 for(const [name,data]of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(unzipSync(edited)[name],name).toEqual(data);
 doc.undo();expect(Math.abs(width()-reference.cases[0].width)).toBeLessThan(.2);
 expect(unzipSync(await save())).toEqual(pkg.parts);
});
