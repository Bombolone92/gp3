import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
const root='tests/fixtures/narrow-filled-paths/',ref=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('binds the native fill geometry and screen evidence to the original control',()=>{
 for(const [file,hash]of [['control.docx',ref.sourceSha256],['native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 expect(ref.cases).toHaveLength(32);
 for(const c of ref.cases){expect(Math.abs(c.nativePdfRectanglePt[3]-c.thicknessPt)).toBeLessThan(.001);expect(c.nativePdfRectanglePt[2]).toBe(45);}
});
it('imports the thin fill declarations without synthesizing outlines and round trips exactly',async()=>{
 const bytes=readFileSync(root+'control.docx'),pkg=await DocxPackage.open(bytes);expect(pkg.readOnly).toBeFalsy();expect(Object.keys(pkg.assets)).toHaveLength(8);
 const visit=s=>{if(s.type==='shape'){expect(s.outline).toBeFalsy();expect(s.paths.every(p=>p.stroke===false)).toBe(true);}for(const c of s.children||[])visit(c);};
 for(const asset of Object.values(pkg.assets))visit(asset.scene);
 const exported=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());expect(unzipSync(exported)).toEqual(unzipSync(bytes));
});
