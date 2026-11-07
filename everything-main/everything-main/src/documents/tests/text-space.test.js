import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { previewParagraphs } from '../src/engine/docx-preview.js';
import { wordText } from '../src/engine/docx-xml.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>{dom.window.close();delete globalThis.DOMParser;delete globalThis.XMLSerializer;});
const source=readFileSync('tests/fixtures/text-space/source.docx');
const expected=['absent|Alpha|end','default|Alpha|end','preserve| Alpha |end','spaces||end','internal|A  B|end','tabs|Alpha|end','newlines|Alpha|end'].join('\n');
const sameParts=(a,b)=>{expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const name of Object.keys(b))expect(Buffer.from(a[name]).equals(Buffer.from(b[name])),name).toBe(true);};

it('matches the native reference edge whitespace in native import and read-only projection',async()=>{
 const p=await DocxPackage.open(source);expect(new TextDocument(p.paragraphs).text).toBe(expected);
 const xml=new DOMParser().parseFromString(strFromU8(p.parts['word/document.xml']),'application/xml');
 expect(new TextDocument(previewParagraphs(xml.documentElement)).text).toBe(expected);
 sameParts(unzipSync(new Uint8Array(await p.export().arrayBuffer())),p.parts);
});

it('retains significant spaces and original package bytes through edit, reopen and undo',async()=>{
 const p=await DocxPackage.open(source),d=new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
 const save=async()=>new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
 d.select(d.text.indexOf(' Alpha ')+1);d.replace('New ');
 expect(new TextDocument((await DocxPackage.open(await save())).paragraphs).text).toBe(expected.replace(' Alpha ',' New Alpha '));
 d.undo();sameParts(unzipSync(await save()),p.parts);
});

it('preserves nonbreaking spaces and internal whitespace while trimming only XML edge whitespace',()=>{
 const node=new DOMParser().parseFromString('<t> \t\n\u00a0A  B\u00a0\t </t>','application/xml').documentElement;
 expect(wordText(node)).toBe('\u00a0A  B\u00a0');
 node.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');expect(wordText(node)).toBe(node.textContent);
});

it('records compatibility for nonconforming ancestor space declarations',async()=>{
 const p=await DocxPackage.open(readFileSync('tests/fixtures/text-space/inherited-nonconforming.docx'));
 expect(new TextDocument(p.paragraphs).text).toBe(expected.replace('spaces||end','run|Alpha|end\nparagraph|Alpha|end\nspaces||end'));
 sameParts(unzipSync(new Uint8Array(await p.export().arrayBuffer())),p.parts);
});
