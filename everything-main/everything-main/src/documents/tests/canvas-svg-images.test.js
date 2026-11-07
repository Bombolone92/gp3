import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { svgInfo } from '../src/engine/svg-images.js';
import { MAX_DOCUMENT_CHARACTERS } from '../src/engine/text-limits.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
const A='http://schemas.openxmlformats.org/drawingml/2006/main', R='http://schemas.openxmlformats.org/officeDocument/2006/relationships', ASVG='http://schemas.microsoft.com/office/drawing/2016/SVG/main';
let dom;
beforeAll(()=>{dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;});
afterAll(()=>dom.window.close());
const source=readFileSync('public/fixtures/svg-pictures.docx');
const model=p=>new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save=async(p,d)=>unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer()));
const same=(a,b,except=[])=>{expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());for(const n of Object.keys(a))if(!except.includes(n))expect(Buffer.from(a[n]).equals(Buffer.from(b[n])),n).toBe(true);};
function revise(path,fn){const p=unzipSync(source),d=new DOMParser().parseFromString(strFromU8(p[path]),'application/xml');fn(d);p[path]=strToU8(new XMLSerializer().serializeToString(d));return zipSync(p);}
it('selects vectors in ordinary pictures, groups and shape fills, preserving both representations through edit/undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),images=d.paragraphs.flatMap(p=>p.runs).filter(r=>r.image).map(r=>r.image);
 expect(images[0]).toMatchObject({assetId:'word/media/vector.svg',fallbackRelId:expect.any(String),relId:'rIdVector'});
 expect(p.assets[images[2].assetId].scene.children[0].image.assetId).toBe('word/media/vector.svg');
 expect(p.assets[images[3].assetId].scene.fill.image.assetId).toBe('word/media/vector.svg');
 same(await save(p,d),p.parts);d.select(0);d.replace('Edited ');const out=await save(p,d);expectBodyEditParts(out,p.parts);
 const reopened=await DocxPackage.open(zipSync(out));expect(Object.keys(reopened.assets)).toEqual(Object.keys(p.assets));
 d.undo();same(await save(p,d),p.parts);
});
it('preserves the SVG relationship during crop/size/alt edits and deletion undo',async()=>{
 const p=await DocxPackage.open(source),d=model(p),at=d.text.indexOf('\ufffc');d.select(at,at+1);
 d.setImageProperties({width:914400,height:609600,alt:'Vector retained',crop:{left:10000,top:0,right:0,bottom:0}});
 const out=await save(p,d),again=await DocxPackage.open(zipSync(out));same(out,p.parts,['word/document.xml']);
 expect(again.paragraphs.flatMap(p=>p.runs).find(r=>r.image).image).toMatchObject({assetId:'word/media/vector.svg',alt:'Vector retained',crop:{left:10000}});
 d.replace('');d.undo();d.undo();same(await save(p,d),p.parts);
});
it.each([
 ['duplicate extension',d=>{const n=d.getElementsByTagNameNS(A,'extLst')[0];n.append(n.lastElementChild.cloneNode(true));}],
 ['unknown extension',d=>d.getElementsByTagNameNS(A,'ext')[0].setAttribute('uri','unknown')],
 ['linked SVG',d=>d.getElementsByTagNameNS(ASVG,'svgBlip')[0].setAttributeNS(R,'r:link','external')],
 ['missing SVG',d=>d.getElementsByTagNameNS(ASVG,'svgBlip')[0].setAttributeNS(R,'r:embed','missing')],
])('rejects %s without attaching an editable representation',async(_,fn)=>{await expect(DocxPackage.open(revise('word/document.xml',fn))).rejects.toThrow();});
it('rejects external SVG relationships and content-type mismatches',async()=>{
 await expect(DocxPackage.open(revise('word/_rels/document.xml.rels',d=>{const n=[...d.documentElement.children].find(n=>n.getAttribute('Id')==='rIdVector');n.setAttribute('TargetMode','External');n.setAttribute('Target','https://example.invalid/a.svg');}))).rejects.toThrow(/external/);
 await expect(DocxPackage.open(revise('[Content_Types].xml',d=>[...d.documentElement.children].find(n=>n.getAttribute('Extension')==='svg').setAttribute('ContentType','image/png')))).rejects.toThrow(/content types/);
});
const svg=body=>strToU8(`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">${body}</svg>`);
it('accepts reused SVG text above the former character ceiling without changing source bytes',()=>{
 const root='tests/fixtures/svg-use-large-text/',source=readFileSync(root+'control.docx');
 const reference=JSON.parse(readFileSync(root+'reference.json','utf8'));
 expect(createHash('sha256').update(source).digest('hex')).toBe(reference.captures[0].sourceSha256);
 const native=readFileSync(root+'large-native.emf');
 expect(native).toEqual(readFileSync(root+'compact-native.emf'));
 expect(createHash('sha256').update(native).digest('hex')).toBe(reference.captures[0].nativeSha256);
 const parts=unzipSync(source);
 const bytes=parts['word/media/vector.svg'],before=bytes.slice();
 expect(svgInfo(bytes)).toMatchObject({width:120,height:80});expect(bytes).toEqual(before);
});
it('counts expanded SVG text in UTF-16 against the shared ceiling before materialization',()=>{
 const text='\u{1f600}'+'a'.repeat(MAX_DOCUMENT_CHARACTERS/2-2);
 const body=value=>`<defs><text id="label">${value}</text></defs><use href="#label"/>`;
 expect(svgInfo(svg(body(text)))).toMatchObject({width:120,height:80});
 expect(()=>svgInfo(svg(body(text+'a')))).toThrow(/SVG instance text exceeds 5,000,000 characters/);
});
it.each(['default', 'preserve'])('accepts XML whitespace mode %s on supported SVG elements without changing bytes', mode => {
 const bytes = svg(`<g xml:space="${mode}"><path d="M0 0 L10 10"/></g>`), before = bytes.slice();
 expect(svgInfo(bytes)).toMatchObject({width:120,height:80}); expect(bytes).toEqual(before);
});
it.each(['xml:space="invalid"', 'xml:space=""', 'xml:base="https://example.invalid/"', 'xmlns:x="urn:other" x:space="preserve"'])('rejects unsupported XML attributes %s', attr => {
 expect(() => svgInfo(svg(`<g ${attr}/>`))).toThrow();
});
it('retains XML whitespace declarations through editing and complete undo', async () => {
 const p = await DocxPackage.open(readFileSync('public/fixtures/svg-space-pictures.docx')), d = model(p);
 d.select(0); d.replace('Edited '); expectBodyEditParts(await save(p,d),p.parts);
 d.undo(); same(await save(p,d),p.parts);
});
it.each([
 ['viewBox="0 0 96 96"', 150, 150],
 ['viewBox="-10 -20 400 100"', 300, 75],
 ['viewBox="0 0 120 80" width="60"', 60, 40],
 ['viewBox="0 0 120 80" height="40"', 60, 40],
 ['viewBox="0 0 120 80" width="100%" height="100%"', 225, 150],
])('sizes automatic SVG dimensions from its aspect ratio: %s', (attrs, width, height) => {
 const bytes = strToU8(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs}/>`), before = bytes.slice();
 expect(svgInfo(bytes)).toEqual({mime:'image/svg+xml',width,height}); expect(bytes).toEqual(before);
});
it.each(['0 0 0 100','0 0 -100 100','0 0 NaN 100','0 0 100','0 0 0x60 96',''])('rejects invalid automatic SVG viewBox %s', box => {
 expect(() => svgInfo(strToU8(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}"/>`))).toThrow();
});
it('opens ratio-only vectors and preserves the original media through editing and undo', async () => {
 const p = await DocxPackage.open(readFileSync('public/fixtures/svg-viewbox-pictures.docx')), d = model(p);
 d.select(0); d.replace('Edited '); const out = await save(p,d); expectBodyEditParts(out,p.parts);
 expect((await DocxPackage.open(zipSync(out))).assets['word/media/vector.svg'].bytes).toEqual(p.parts['word/media/vector.svg']);
 d.undo(); same(await save(p,d),p.parts);
});
it.each(['<script>bad()</script>','<image href="https://example.invalid/a.png"/>','<foreignObject/>','<animate/>','<path onload="bad()"/>','<style>@import "remote";</style>','<path fill="url(https://example.invalid/a.svg#x)"/>','<path style="fill:var(--color)"/>','<?xml-stylesheet href="remote"?>','<style>.x { animation:spin 1s; }</style>'])('rejects active or unsupported SVG %s',body=>expect(()=>svgInfo(svg(body))).toThrow());
it('reads physical dimensions and keeps source bytes immutable',()=>{
 const bytes=strToU8('<svg xmlns="http://www.w3.org/2000/svg" width="1.5in" height="72pt"><rect width="100%" height="100%" fill="#123456"/></svg>'),before=bytes.slice();
 expect(svgInfo(bytes)).toEqual({mime:'image/svg+xml',width:144,height:96});expect(bytes).toEqual(before);
});

it.each([
 '<defs><rect id="r" width="10" height="10"/></defs><use href="#r" x="5" y="10%"/>',
 '<defs><g id="g"><use href="#r"/></g><rect id="r"/></defs><use href="#g"/>',
 '<defs><rect id="r"/></defs><use xmlns:xlink="http://www.w3.org/1999/xlink" href="#ignored" xlink:href="#r"/>',
 '<use><title>Empty instance</title></use>',
])('accepts bounded local SVG instances without changing source bytes: %s', body => {
 const bytes = svg(body), before = bytes.slice();
 expect(svgInfo(bytes)).toMatchObject({width:120,height:80}); expect(bytes).toEqual(before);
});
it.each([
 ['self reference', '<use id="a" href="#a"/>'],
 ['indirect cycle', '<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/>'],
 ['ancestor cycle', '<g id="a"><use href="#a"/></g>'],
 ['external reference', '<use href="https://example.invalid/vector.svg#r"/>'],
 ['missing target', '<use href="#missing"/>'],
 ['invalid target', '<defs><linearGradient id="g"/></defs><use href="#g"/>'],
 ['invalid position', '<defs><rect id="r"/></defs><use href="#r" x="NaN"/>'],
 ['nonfinite position', '<defs><rect id="r"/></defs><use href="#r" x="1e999"/>'],
 ['unexpected child', '<use><rect/></use>'],
])('guards %s in SVG instances', (_, body) => expect(() => svgInfo(svg(body))).toThrow(/Unsupported SVG/));
it('bounds the expanded SVG graph independently of source element count', () => {
 const nodes = ['<g id="a0"><rect width="10" height="10"/></g>'];
 for (let i=1;i<15;i++) nodes.push(`<g id="a${i}"><use href="#a${i-1}"/><use href="#a${i-1}"/></g>`);
 expect(() => svgInfo(svg(`<defs>${nodes.join('')}</defs><use href="#a14"/>`))).toThrow(/instance complexity/);
});
it('bounds nonbreaking-space preview spans across reused text', () => {
 const text = 'a\u00a0'.repeat(9000);
 expect(() => svgInfo(svg(`<defs><text id="t">${text}</text></defs><use href="#t"/><use href="#t"/>`))).toThrow(/instance complexity/);
});
it.each(['svg-use-pictures','svg-use-styles'])('retains %s definitions and references through editing, reopening and exact undo', async name => {
 const p = await DocxPackage.open(readFileSync(`public/fixtures/${name}.docx`)), d = model(p);
 same(await save(p,d),p.parts); d.select(0); d.replace('Edited ');
 const out = await save(p,d); expectBodyEditParts(out,p.parts);
 const reopened = await DocxPackage.open(zipSync(out));
 expect(reopened.assets['word/media/vector.svg'].bytes).toEqual(p.parts['word/media/vector.svg']);
 d.undo(); same(await save(p,d),p.parts);
});
