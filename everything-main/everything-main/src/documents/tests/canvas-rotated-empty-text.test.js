import {beforeAll,afterAll,it,expect} from 'vitest';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {DocxPackage} from '../src/engine/docx.js';
import {TextDocument} from '../src/engine/model.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('tests/fixtures/rotated-empty-text/control.docx');
// Paragraph IDs are allocated afresh on import; compare retained scene data.
const scenes=p=>JSON.parse(JSON.stringify(Object.values(p.assets).filter(a=>a.scene).map(a=>a.scene),(key,value)=>key==='id'?undefined:value));
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main',WPS='http://schemas.microsoft.com/office/word/2010/wordprocessingShape';
const mutate=fn=>{const parts=unzipSync(source),doc=new DOMParser().parseFromString(strFromU8(parts['word/document.xml']),'application/xml');fn(doc);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));return zipSync(parts);};
it('retains empty paragraphs and shape rotations through edits, export and undo',async()=>{
 const p=await DocxPackage.open(source),before=scenes(p);expect(before).toHaveLength(4);
 for(const s of before){expect(s.children).toHaveLength(2);const[a,b]=s.children;expect(a.text).toBeNull();expect(b.text.paragraphs).toHaveLength(1);expect(b.text.paragraphs[0].runs.every(r=>!r.text&&!r.field)).toBe(true);expect(b.shapeRotation).toBe(a.shapeRotation);expect(b.paths).toEqual(a.paths);}
 expect(before.map(s=>s.children[1].shapeRotation||0)).toEqual([0,1800000,21398351,5400000]);
 const d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 const same=out=>{expect(Object.keys(out).sort()).toEqual(Object.keys(p.parts).sort());for(const[n,b]of Object.entries(p.parts))expect(Buffer.from(out[n]).equals(Buffer.from(b)),n).toBe(true);};
 same(unzipSync(await save()));d.select(0);d.replace('Edited ');const edited=await save();expect(scenes(await DocxPackage.open(edited))).toEqual(before);
 for(const[n,b]of Object.entries(p.parts))if(n!=='word/document.xml')expect(Buffer.from(unzipSync(edited)[n]).equals(Buffer.from(b)),n).toBe(true);
 d.undo();same(unzipSync(await save()));
});
it.each(['text','field','malformed'])('does not bypass text-box validation for %s',async kind=>{
 const bytes=mutate(doc=>{const content=doc.getElementsByTagNameNS(WPS,'txbx')[1].firstElementChild,p=content.firstElementChild;
  if(kind==='malformed'){content.removeChild(p);return;}
  const r=doc.createElementNS(W,'w:r');p.appendChild(r);
  const t=doc.createElementNS(W,kind==='text'?'w:t':'w:fldChar');if(kind==='text')t.textContent='Visible';else t.setAttributeNS(W,'w:fldCharType','begin');r.appendChild(t);
 });
 if(kind==='text')expect(JSON.stringify(scenes(await DocxPackage.open(bytes)))).toContain('Visible');
 else await expect(DocxPackage.open(bytes)).rejects.toThrow(/field|complex text box/);
});
