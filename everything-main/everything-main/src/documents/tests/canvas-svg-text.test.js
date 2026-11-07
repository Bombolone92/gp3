import { MAX_DOCUMENT_CHARACTERS } from '../src/engine/text-limits.js';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { svgInfo } from '../src/engine/svg-images.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const svg=body=>strToU8(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120">${body}</svg>`);
it('retains every SVG and raster fallback through editing, reopening and exact undo',async()=>{
 const bytes=readFileSync('tests/fixtures/svg-text/svg-text.docx'),parts=unzipSync(bytes),pkg=await DocxPackage.open(bytes);
 const doc=new TextDocument(pkg.paragraphs,pkg.pageSettings,pkg.numbering,pkg.styles,pkg.tables,pkg.assets);
 const save=async()=>new Uint8Array(await pkg.export(doc.paragraphs,doc.pageSettings,doc.numbering,doc.styles,doc.tables,doc.assets).arrayBuffer());
 expect(unzipSync(await save())).toEqual(parts);doc.select(0);doc.replace('Edited ');
 const edited=await save(),out=unzipSync(edited);expectBodyEditParts(out,parts);
 const reopened=await DocxPackage.open(edited);expect(Object.keys(reopened.assets)).toEqual(Object.keys(pkg.assets));
 doc.undo();expect(unzipSync(await save())).toEqual(parts);
},30000);
it.each([
 '<text font-family="Arial, sans-serif" x="10" y="20">One<tspan dx="2" dy="3" rotate="10" font-weight="bold">Two</tspan></text>',
 '<text style="font-family:\'Times New Roman\', serif;font-size:24px;letter-spacing:1px" textLength="100" lengthAdjust="spacingAndGlyphs">Text</text>',
 '<text xml:space="preserve" direction="rtl" unicode-bidi="embed">אבג</text>',
 '<text font-family="日本語 フォント" font-style="italic"><![CDATA[<literal>]]></text>',
])('accepts static text properties while preserving source bytes: %s',content=>{
 const bytes=svg(content),before=bytes.slice();expect(svgInfo(bytes)).toMatchObject({width:300,height:120});expect(bytes).toEqual(before);
});
it.each([
 '<text font-family="url(https://example.invalid/font)">Text</text>',
 '<text style="font-family:var(--family)">Text</text>',
 '<text style="font-family:Arial!important">Text</text>',
 '<text font-family="Arial;src:remote">Text</text>',
 '<style>@font-face {font-family:Remote;src:url(remote.woff)}</style><text>Text</text>',
 '<text onload="alert(1)">Text</text>',
 '<text><tspan href="https://example.invalid/">Text</tspan></text>',
 '<text><textPath href="#path">Text</textPath></text>',
 '<g>Text outside a text element</g>',
])('continues rejecting active or unsupported SVG text: %s',content=>expect(()=>svgInfo(svg(content))).toThrow(/Unsupported SVG/));
it('bounds text and possible preview span expansion before browser decoding',()=>{
 expect(()=>svgInfo(svg('<text>'+ 'A'.repeat(MAX_DOCUMENT_CHARACTERS + 1) +'</text>'))).toThrow(/5,000,000/);
 expect(()=>svgInfo(svg('<text letter-spacing="2">'+ 'A\u00a0'.repeat(20001) +'</text>'))).toThrow(/complexity/);
});
