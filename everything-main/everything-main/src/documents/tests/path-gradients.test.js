import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { canvasCircularGradient, readLinearGradient } from '../src/engine/drawing-gradients.js';
const folder='tests/fixtures/path-gradients';
const cases=JSON.parse(readFileSync(`${folder}/cases.json`));
const reference=JSON.parse(readFileSync(`${folder}/reference.json`));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
for (const [i,c] of cases.entries()) it(`imports native circular control ${c.name}`, async()=>{
 const pkg=await DocxPackage.open(readFileSync(`${folder}/control.docx`));
 const fill=Object.values(pkg.assets)[i].scene.fill;
 expect(fill.type).toBe('circularGradient');
 const calls=[];
 const gradient={addColorStop:(...args)=>calls.push(args)};
 const ctx={createRadialGradient:(...args)=>{expect(args.slice(0,5)).toEqual([105,32.5,0,105,32.5]);expect(Math.abs(args[5]-reference.cases[i].radius)).toBeLessThan(.01);return gradient;}};
 expect(canvasCircularGradient(ctx,fill,c.width,c.height)).toBe(gradient);
 expect(calls).toHaveLength(c.count === 2 && c.alpha === 100000 ? 256 : c.count);
});
it('preserves circular gradients through edit, reopen and exact undo',async()=>{
 const bytes=readFileSync(`${folder}/control.docx`),pkg=await DocxPackage.open(bytes);
 const fills=Object.values(pkg.assets).map(a=>a.scene.fill);
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 doc.select(0);doc.replace('Edited ');const edited=await save();
 expect(Object.values((await DocxPackage.open(edited)).assets).map(a=>a.scene.fill)).toEqual(fills);
 for(const [name,data] of Object.entries(pkg.parts))if(name!=='word/document.xml')expect(unzipSync(edited)[name]).toEqual(data);
 doc.undo();expect(unzipSync(await save())).toEqual(unzipSync(bytes));
});

it('binds the native reference to the exact independent source, cases and PDF',()=>{
 for(const [name,key] of [['control.docx','sourceSha256'],['native.pdf','pdfSha256'],['cases.json','casesSha256']])
  expect(createHash('sha256').update(readFileSync(`${folder}/${name}`)).digest('hex')).toBe(reference[key]);
});
it('does not construct radial paints for zero-area geometry',()=>{
 expect(canvasCircularGradient(null,{},0,100)).toBe('rgba(0,0,0,0)');
 expect(canvasCircularGradient(null,{},100,0)).toBe('rgba(0,0,0,0)');
});
const stops='<a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs></a:gsLst>';
it.each(['<a:path path="circle"/><a:lin/>','<a:path path="shape"/>','<a:path path="circle"><a:fillToRect l="bad"/></a:path>','<a:path path="circle"><a:fillToRect/><a:fillToRect/></a:path>'])('rejects malformed or unsupported path shading %s',tail=>{
 const node=new DOMParser().parseFromString(`<a:gradFill xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${stops}${tail}</a:gradFill>`,'application/xml').documentElement;
 expect(()=>readLinearGradient(node)).toThrow();
});
