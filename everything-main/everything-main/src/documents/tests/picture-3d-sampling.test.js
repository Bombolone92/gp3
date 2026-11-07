import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {unzipSync} from 'fflate';
import {JSDOM} from 'jsdom';
import {DocxPackage} from '../src/engine/docx.js';
const root='tests/fixtures/picture-3d-sampling/',ref=JSON.parse(readFileSync(root+'native.json'));
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
it('binds native minification evidence to original authored source and all six captures',()=>{
 expect(createHash('sha256').update(readFileSync(root+'control.docx')).digest('hex')).toBe(ref.capture.sourceSha256);
 expect(ref.cases).toHaveLength(6);
 for(const c of ref.capture.captures)expect(createHash('sha256').update(gunzipSync(readFileSync(root+c.file+'.gz'))).digest('hex')).toBe(c.sha256);
 for(const [i,c] of ref.capture.captures.entries())expect(createHash('sha256').update(gunzipSync(readFileSync(root+c.file+'.rgb.gz'))).digest('hex')).toBe(ref.cases[i].nativeRgbSha256);
 expect(ref.cases[0].nativeStd).toBe(0);
});
it('strictly imports and preserves every original texture and package part',async()=>{
 const bytes=readFileSync(root+'control.docx'),pkg=await DocxPackage.open(bytes);
 expect(pkg.readOnly).toBeFalsy();
 expect(Object.values(pkg.assets).filter(a=>a.scene?.type==='picture3d')).toHaveLength(6);
 const exported=new Uint8Array(await pkg.export(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets).arrayBuffer());
 expect(unzipSync(exported)).toEqual(unzipSync(bytes));
},30000); // Full six-picture import and OPC serialization, like canvas-picture-3d.
