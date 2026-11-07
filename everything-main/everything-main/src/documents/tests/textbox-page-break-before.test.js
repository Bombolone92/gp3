import { assertPackageParts } from './helpers/assert-package-parts.js';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import {layoutShapeText} from '../src/engine/shape-text-layout.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/textbox-page-break-before/control.docx');
const frames=p=>{const out=[];const visit=n=>{if(n.text)out.push(n);n.children?.forEach(visit);};Object.values(p.assets).filter(a=>a.scene).forEach(a=>visit(a.scene));return out;};
it('retains resolved break declarations but suppresses only their text-frame layout effect',async()=>{
 const p=await DocxPackage.open(source),nodes=frames(p);expect(nodes).toHaveLength(7);
 expect(nodes.map(n=>n.text.paragraphs.map(p=>p.format.pageBreakBefore))).toEqual([[false,false,false],[true,false,false],[false,true,false],[false,false,true],[true,true,true],[true,true,true],[false,false,false]]);
 const before=JSON.stringify(nodes),measure=(t,f)=>({width:t.length*f.fontSize*.6,ascent:f.fontSize,descent:f.fontSize*.2});
 const layouts=nodes.map(n=>layoutShapeText(n,measure));
 for(const l of layouts){expect(l.layout.pages).toHaveLength(1);expect(l.layout.lines.map(x=>[x.x,x.y,x.baseline])).toEqual(layouts[0].layout.lines.map(x=>[x.x,x.y,x.baseline]));}
 expect(JSON.stringify(nodes)).toBe(before);
});
it('preserves text-box declarations through body editing, export, reopening and exact undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),parts=unzipSync(source);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 assertPackageParts(unzipSync(await save()), parts);d.select(0);d.replace('Edited ');const edited=await save(),out=unzipSync(edited);
 expectBodyEditParts(out,parts);
 const stable=v=>JSON.parse(JSON.stringify(v,(k,x)=>k==='id'&&typeof x==='string'&&/^p\d+$/.test(x)?'<paragraph>':x));
 expect(stable(frames(await DocxPackage.open(edited)))).toEqual(stable(frames(p)));
 d.undo();assertPackageParts(unzipSync(await save()), parts);
});
