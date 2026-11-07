import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage,createDocx} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('public/fixtures/default-run-size.docx');
const sizes=p=>p.paragraphs.map(p=>p.runs.filter(r=>r.text).map(r=>r.fontSize));
it('matches the independent native reference control for an absent run size and explicit overrides',async()=>{
 const p=await DocxPackage.open(source);expect(sizes(p)).toEqual([[10],[10],[12]]);
});
it.each(['defaults','styles'])('uses the same imported size with no %s',async missing=>{
 const parts=unzipSync(source);
 if(missing==='defaults')parts['word/styles.xml']=strToU8(strFromU8(parts['word/styles.xml']).replace(/<w:docDefaults>.*?<\/w:docDefaults>/,''));
 else{delete parts['word/styles.xml'];parts['word/_rels/document.xml.rels']=strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace(/<Relationship Id="styles"[^>]*\/>/,''));}
 expect(sizes(await DocxPackage.open(zipSync(parts)))).toEqual([[10],[10],[12]]);
});
it('keeps an explicit document size ahead of the consumer fallback',async()=>{
 const parts=unzipSync(source);parts['word/styles.xml']=strToU8(strFromU8(parts['word/styles.xml']).replace('<w:rPr>','<w:rPr><w:sz w:val="32"/>'));
 expect(sizes(await DocxPackage.open(zipSync(parts)))).toEqual([[16],[10],[12]]);
});
it('preserves package parts through editing, reopen and exact undo without injecting default sizes',async()=>{
 const p=await DocxPackage.open(source),m=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets),parts=unzipSync(source);
 const save=async()=>new Uint8Array(await p.export(m.paragraphs,m.pageSettings,m.numbering,m.styles,m.tables,m.assets).arrayBuffer());
 const same=data=>{const out=unzipSync(data);for(const n of Object.keys(parts))expect(Buffer.from(out[n]).equals(Buffer.from(parts[n])),n).toBe(true);};
 same(await save());m.select(0);m.replace('Edited ');const edited=await save(),out=unzipSync(edited);
 expect(sizes(await DocxPackage.open(edited))).toEqual([[10],[10],[12]]);
 expect(Buffer.from(out['word/styles.xml']).equals(Buffer.from(parts['word/styles.xml']))).toBe(true);
 m.undo();same(await save());
});

it('keeps newly authored documents at their explicit 12 pt default',async()=>{
 const p=createDocx();expect(p.styles.defaults.run.fontSize).toBe(12);
 const reopened=await DocxPackage.open(new Uint8Array(await p.export().arrayBuffer()));expect(reopened.styles.defaults.run.fontSize).toBe(12);
});
it.each(['paragraph','character'])('inherits an explicit %s style size',async type=>{
 const parts=unzipSync(source);parts['word/styles.xml']=strToU8(strFromU8(parts['word/styles.xml']).replace('</w:styles>',`<w:style w:type="${type}" w:styleId="Sized"><w:name w:val="Sized"/><w:rPr><w:sz w:val="30"/></w:rPr></w:style></w:styles>`));
 let doc=strFromU8(parts['word/document.xml']);doc=type==='paragraph'?doc.replace('<w:p>','<w:p><w:pPr><w:pStyle w:val="Sized"/></w:pPr>'):doc.replace('<w:r>','<w:r><w:rPr><w:rStyle w:val="Sized"/></w:rPr>');parts['word/document.xml']=strToU8(doc);
 expect(sizes(await DocxPackage.open(zipSync(parts)))).toEqual([[15],[10],[12]]);
});
