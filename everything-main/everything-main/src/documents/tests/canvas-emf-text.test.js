import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
import {emfInfo} from '../src/engine/emf-images.js';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
const source=readFileSync('tests/fixtures/emf-text/control.docx'),parts=unzipSync(source),base=parts['word/media/control0.emf'];
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
function offset(bytes,type){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);for(let at=0;at<bytes.length;at+=v.getUint32(at+4,true))if(v.getUint32(at,true)===type)return at;throw Error('Missing record');}
it('imports eight text controls and preserves their media through edit, reopen and undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 for(let i=0;i<8;i++){const svg=emfInfo(parts[`word/media/control${i}.emf`]).svg;expect(svg).toContain('&amp;');expect(svg).toContain('Ω');expect(svg.match(/<tspan /g)).toHaveLength(5);}
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.replace('Edited ');const edited=await save();await DocxPackage.open(edited);
 for(const[n,b]of Object.entries(parts))if(n!=='word/document.xml')expect(unzipSync(edited)[n]).toEqual(b);
 d.undo();expect(unzipSync(await save())).toEqual(parts);
});
it.each([
 ['text overrun',84,44,100000],['string offset',84,48,2],['advance offset',84,72,3],
 ['glyph indexes',84,52,16],['rotated font',82,20,900],['cell-height font',82,12,120],
 ['unknown font handle',37,8,8],['unsupported alignment',22,8,1],
])('rejects %s',(_,type,field,value)=>{
 const bytes=base.slice(),view=new DataView(bytes.buffer);view.setInt32(offset(bytes,type)+field,value,true);
 expect(()=>emfInfo(bytes)).toThrow(/Unsupported EMF/);
});
it('preserves compatible-mode glyph width while scaling character origins',()=>{
 const svg=emfInfo(parts['word/media/control7.emf']).svg;
 expect(svg).toContain('transform="matrix(1 0 0 1 0 0)"');expect(svg).toContain('font-size="24"');
});
it('records only fonts whose selected state actually emits text',()=>{
 const bytes=base.slice(),view=new DataView(bytes.buffer);
 expect(emfInfo(bytes).textFonts).toEqual([['Arial']]);
 // The same font remains created and selected, but no characters are emitted.
 view.setUint32(offset(bytes,84)+44,0,true);
 expect(emfInfo(bytes).textFonts).toEqual([]);
});
