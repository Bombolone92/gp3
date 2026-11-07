import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
const root='tests/fixtures/picture-3d-textures/',ref=JSON.parse(readFileSync(root+'reference.json'));
let dom;beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('binds all eight native texture fields to the independent source and PDF',()=>{
 for(const [file,hash]of [['control.docx',ref.sourceSha256],['native.pdf',ref.pdfSha256]])expect(createHash('sha256').update(readFileSync(root+file)).digest('hex')).toBe(hash);
 expect(ref.cases).toHaveLength(8);for(const c of ref.cases){expect(c.samples).toHaveLength(49);expect(c.pdfImageFilters).toEqual([c.texture==='gray'?'/FlateDecode':'/DCTDecode']);}
});
it('strictly imports and round trips every original textured scene without replacing its media',async()=>{
 const bytes=readFileSync(root+'control.docx'),pkg=await DocxPackage.open(bytes),scenes=Object.values(pkg.assets).filter(a=>a.scene?.type==='picture3d'||a.scene?.geometry&&a.scene?.lighting);
 expect(pkg.readOnly).toBeFalsy();expect(scenes).toHaveLength(8);
 const output=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());expect(unzipSync(output)).toEqual(unzipSync(bytes));
});
