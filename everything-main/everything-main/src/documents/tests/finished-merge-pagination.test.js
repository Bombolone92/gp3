import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, caretRect, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const folder='tests/fixtures/finished-merge-pagination',refs=JSON.parse(readFileSync(`${folder}/reference.json`));
const measure=(text,style)=>({width:text.length*style.fontSize*2/3,ascent:style.fontSize,descent:style.fontSize/3});
for(const [name,ref] of Object.entries(refs))it(`${name}: completed owners add no pages, continuing source survives and undo preserves layout/package`,async()=>{
  for(const [file,hash] of Object.entries(ref.hashes))expect(createHash('sha256').update(readFileSync(`${folder}/${file}`)).digest('hex')).toBe(hash);
  const source=readFileSync(`${folder}/${name}.docx`),p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
  const layout=()=>layoutDocument(d.paragraphs,measure,pageGeometry(d.pageSettings),d.numbering,d.tables,p.pageStories);
  const before=layout();expect(before.pageCount).toBe(ref.pages);
  for(const expected of ref.lines){const line=before.lines.find(l=>l.fragments.map(f=>f.text||'').join('').trim()===expected.text);expect(line?.page,expected.text).toBe(expected.page);}
  const line=before.lines.find(l=>l.fragments.some(f=>f.text==='Body A')),caret=caretRect(before,line.start);
  expect(hitTest(before,caret.page,caret.x,caret.y+caret.height/2)).toBe(line.start);
  const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
  d.select(0);d.replace('Edited ');const edited=await save(),out=unzipSync(edited),parts=unzipSync(source);
  expect((await DocxPackage.open(edited)).paragraphs[0].runs.map(r=>r.text).join('')).toContain('Edited ');
  for(const file of Object.keys(parts))if(file!=='word/document.xml')expect(Buffer.from(out[file]).equals(Buffer.from(parts[file])),file).toBe(true);
  d.undo();expect(layout()).toEqual(before);const undone=unzipSync(await save());
  for(const file of Object.keys(parts))expect(Buffer.from(undone[file]).equals(Buffer.from(parts[file])),file).toBe(true);
});
