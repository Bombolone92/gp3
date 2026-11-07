import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=name=>readFileSync(`tests/fixtures/image-content-types/${name}.docx`);
const save=async(p,d)=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
it.each(['correct','jpeg-payload-png-name','png-payload-jpeg-name'])('decodes validated raster bytes and preserves %s through edit and undo',async name=>{
 const bytes=source(name),p=await DocxPackage.open(bytes),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 expect(Object.values(p.assets).map(a=>a.mime).sort()).toEqual(['image/jpeg','image/png']);
 const original=unzipSync(bytes);expect(unzipSync(await save(p,d))).toEqual(original);
 d.select(0);d.replace('Edited ');const out=await save(p,d),parts=unzipSync(out);
 expectBodyEditParts(parts,original);
 const reopened=await DocxPackage.open(out);expect(Object.values(reopened.assets).map(a=>a.mime).sort()).toEqual(['image/jpeg','image/png']);
 d.undo();expect(unzipSync(await save(p,d))).toEqual(original);
},60000);
it.each(['mismatched','jpeg-as-png','png-as-jpeg'])('retains the guard for declarations contradicting payload and extension: %s',async name=>{
 await expect(DocxPackage.open(source(name))).rejects.toThrow('incorrect image content types');
});
it.each(['png','bin'])('rejects missing declarations even when the %s part contains valid PNG bytes',async extension=>{
 const parts=unzipSync(source('correct'));
 const types=new DOMParser().parseFromString(strFromU8(parts['[Content_Types].xml']),'application/xml');
 [...types.documentElement.children].find(n=>n.getAttribute('Extension')==='png').remove();
 parts['[Content_Types].xml']=strToU8(new XMLSerializer().serializeToString(types));
 if(extension==='bin'){
  const path=Object.keys(parts).find(n=>n.startsWith('word/media/')&&n.endsWith('.png')),renamed=path.replace(/\.png$/,'.bin');
  parts[renamed]=parts[path];delete parts[path];
  const rel='word/_rels/document.xml.rels';parts[rel]=strToU8(strFromU8(parts[rel]).replace(path.slice(5),renamed.slice(5)));
 }
 await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow('incorrect image content types');
});
