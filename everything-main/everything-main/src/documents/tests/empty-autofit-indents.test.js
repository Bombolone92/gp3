import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument,paragraph} from '../src/engine/model.js';
import {cellIntrinsicWidths} from '../src/engine/intrinsic-widths.js';
import {listMarkers} from '../src/engine/numbering.js';
import {layoutDocument} from '../src/engine/layout.js';
import {pageGeometry} from '../src/engine/page-settings.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/empty-autofit-indents',source=readFileSync(`${folder}/control.docx`),reference=JSON.parse(readFileSync(`${folder}/reference.json`));
it('retains native reference hashes',()=>{for(const[n,h]of Object.entries(reference.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${n}`)).digest('hex')).toBe(h);});
it('keeps an empty list item’s visible marker in the AutoFit demand',()=>{
 const d=new TextDocument([paragraph('')]);
 const measure=(t,s)=>({width:t.length*s.fontSize*2/3,ascent:s.fontSize,descent:s.fontSize/3});
 const widths=()=>cellIntrinsicWidths({margins:{left:40,right:40},content:[{paragraph:d.paragraphs[0],index:0}]},measure,pageGeometry(d.pageSettings),d.numbering,listMarkers(d.paragraphs,d.numbering));
 const plain=widths();d.toggleList('bullet');expect(widths().min).toBeGreaterThan(plain.min+20);
});
it('ignores empty paragraph indents without ignoring spaces, breaks, tabs or text',async()=>{
 const p=await DocxPackage.open(source),layout=layoutDocument(p.paragraphs,(t,s)=>({width:t.length*s.fontSize*2/3,ascent:s.fontSize,descent:s.fontSize/3}),pageGeometry(p.pageSettings),p.numbering,p.tables);
 const centers=p.tables.map(t=>layout.cells.find(c=>c.id===t.rows[0].cells[1].id));
 expect(centers).toHaveLength(10);
 for(let i=1;i<6;i++)expect(centers[i].width).toBeCloseTo(centers[0].width,6);
 for(let i=6;i<10;i++)expect(centers[i].width).toBeGreaterThan(centers[0].width*2);
});
it('retains empty indentation declarations through editing, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),parts=unzipSync(source);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.replace('Edited ');const edited=await save(),out=unzipSync(edited),reopened=await DocxPackage.open(edited);
 const indents=p.paragraphs.filter(p=>!p.runs.some(r=>r.text)).map(p=>p.format);
 expect(reopened.paragraphs.filter(p=>!p.runs.some(r=>r.text)).map(p=>p.format)).toEqual(indents);
 for(const n of Object.keys(parts))if(n!=='word/document.xml')expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);
 d.undo();const undo=unzipSync(await save());for(const n of Object.keys(parts))expect(Buffer.from(undo[n]).equals(Buffer.from(parts[n])),n).toBe(true);
});
