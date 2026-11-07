import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { hyperlinkRanges, openableHyperlink } from '../src/engine/hyperlinks.js';
import { hyperlinkAtPoint } from '../src/engine/hyperlink-hit.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = readFileSync('tests/fixtures/drawing-hyperlinks/precedence.docx');
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const model = p => new TextDocument(p.paragraphs,p.pageSettings,p.numbering,p.styles,p.tables,p.assets);
const save = async (p,d) => new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles,d.tables,d.assets).arrayBuffer());
const xml = bytes => new DOMParser().parseFromString(strFromU8(bytes),'application/xml');
const sameParts = (actual, expected, except = []) => { expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort()); for (const name of Object.keys(expected)) if (!except.includes(name)) expect(Buffer.from(actual[name]).equals(Buffer.from(expected[name])), name).toBe(true); };
const images = p => p.paragraphs.flatMap(p=>p.runs.filter(r=>r.image).map(r=>r.image));
const alter = fn => { const parts=unzipSync(source), doc=xml(parts['word/document.xml']);fn(doc,parts);parts['word/document.xml']=strToU8(new XMLSerializer().serializeToString(doc));return zipSync(parts); };
const link = doc => doc.getElementsByTagNameNS(WP,'docPr')[0].getElementsByTagNameNS(A,'hlinkClick')[0];

it('matches the native reference outer-link precedence and preserves all inactive inner metadata', async () => {
  const p=await DocxPackage.open(source),d=model(p);
  expect(images(p).map(i=>i.hyperlink?.target)).toEqual(['https://example.com/outer',undefined,'https://example.com/outer',undefined]);
  expect(hyperlinkRanges(d.paragraphs)).toHaveLength(2);
  sameParts(unzipSync(await save(p,d)),p.parts);
  d.select(0);d.replace('Edited ');
  const bytes=await save(p,d), parts=unzipSync(bytes), original=xml(p.parts['word/document.xml']), actual=xml(parts['word/document.xml']);
  expect([...actual.getElementsByTagNameNS(A,'hlinkClick')].map(n=>n.getAttributeNS(R,'id'))).toEqual([...original.getElementsByTagNameNS(A,'hlinkClick')].map(n=>n.getAttributeNS(R,'id')));
  expectBodyEditParts(parts,p.parts);
  expect(images(await DocxPackage.open(bytes)).map(i=>i.hyperlink?.target)).toEqual(images(p).map(i=>i.hyperlink?.target));
  d.undo();sameParts(unzipSync(await save(p,d)),p.parts);
});

it('edits one active drawing link without changing a shared relationship or adding a text wrapper', async () => {
  const p=await DocxPackage.open(source),d=model(p),r=hyperlinkRanges(d.paragraphs)[0];d.select(r.start,r.end);
  expect(d.hyperlink.link.target).toBe('https://example.com/outer');
  d.setHyperlink('https://example.com/changed');
  const bytes=await save(p,d),reopened=await DocxPackage.open(bytes),parts=unzipSync(bytes);
  expect(images(reopened).map(i=>i.hyperlink?.target)).toEqual(['https://example.com/changed',undefined,'https://example.com/outer',undefined]);
  expect(xml(parts['word/document.xml']).getElementsByTagNameNS(W,'hyperlink')).toHaveLength(0);
  expect(strFromU8(parts['word/_rels/document.xml.rels'])).toContain('https://example.com/outer');
  sameParts(parts,p.parts,['word/document.xml','word/_rels/document.xml.rels']);
  d.removeHyperlink();expect(images(await DocxPackage.open(await save(p,d)))[0].hyperlink).toBeUndefined();
  d.undo();d.undo();sameParts(unzipSync(await save(p,d)),p.parts);
});

it('retains arbitrary inactive inner target frames without activating them', async () => {
  const p = await DocxPackage.open(readFileSync('tests/fixtures/drawing-hyperlinks/inner-frames.docx')), d = model(p);
  expect(images(p).map(i => i.hyperlink?.target)).toEqual(['https://example.com/outer', undefined, 'https://example.com/outer', undefined]);
  sameParts(unzipSync(await save(p, d)), p.parts);
  d.select(0); d.replace('Edit ');
  const bytes = await save(p, d), reopened = await DocxPackage.open(bytes);
  expect(hyperlinkRanges(reopened.paragraphs)).toHaveLength(2);
  const frames = parts => [...xml(parts['word/document.xml']).getElementsByTagNameNS(A, 'hlinkClick')].map(n => n.getAttribute('tgtFrame'));
  expect(frames(reopened.parts)).toEqual(frames(p.parts));
  expectBodyEditParts(reopened.parts, p.parts);
  d.undo(); sameParts(unzipSync(await save(p, d)), p.parts);
});

it('hits active image frames and leaves inactive inner-only pictures unlinked', async () => {
  const p=await DocxPackage.open(source),d=model(p);
  const layout=layoutDocument(d.paragraphs,(t,s)=>({width:t.length*6,ascent:s.fontSize,descent:s.fontSize/4}),pageGeometry(d.pageSettings),d.numbering,d.tables);
  const frames=layout.lines.flatMap(l=>l.fragments.filter(f=>f.image).map(f=>({l,f})));
  expect(frames).toHaveLength(4);
  frames.forEach(({l,f},i)=>expect(hyperlinkAtPoint(layout,d.paragraphs,l.page,f.x+f.width/2,l.baseline-f.ascent/2)?.link.target).toBe(i===0||i===2?'https://example.com/outer':undefined));
});

it('rejects unsupported bookmark retargeting before changing document or history', async () => {
  const p=await DocxPackage.open(source),d=model(p),r=hyperlinkRanges(d.paragraphs)[0];d.select(r.start,r.end);const before=d.snapshot();
  expect(()=>d.setHyperlink({anchor:'Target'})).toThrow('Drawing hyperlinks to bookmarks');expect(d.snapshot()).toEqual(before);
});

it.each([
  ['action', (n)=>n.setAttribute('action','run-script')],
  ['sound', (n)=>n.setAttribute('endSnd','true')],
  ['boolean', (n)=>n.setAttribute('history','maybe')],
  ['attribute', (n)=>n.setAttribute('unknown','1')],
  ['frame', (n)=>n.setAttribute('tgtFrame','_self')],
  ['quoted active frame', (n)=>n.setAttribute('tgtFrame','"_blank"')],
  ['child', (n)=>n.append(n.ownerDocument.createElementNS(A,'a:snd'))],
  ['missing relationship', (n)=>n.setAttributeNS(R,'r:id','missing')],
  ['duplicate link', (n)=>n.parentElement.append(n.cloneNode(true))],
])('keeps unsupported drawing hyperlink %s guarded', async (_,fn)=>{
  await expect(DocxPackage.open(alter(doc=>fn(link(doc))))).rejects.toThrow(/drawing/);
});

it.each(['javascript:alert(1)','file:///C:/private','https://example.com/%ZZ','../Shared Documents/plan.docx'])('retains unopenable drawing targets verbatim: %s',async target=>{
  const bytes=alter((doc,parts)=>{
    const rels=xml(parts['word/_rels/document.xml.rels']);[...rels.documentElement.children].find(n=>n.getAttribute('Id')==='probeOuter').setAttribute('Target',target);
    parts['word/_rels/document.xml.rels']=strToU8(new XMLSerializer().serializeToString(rels));
  });
  const pkg=await DocxPackage.open(bytes);expect(pkg.readOnly).not.toBe(true);
  const image=pkg.paragraphs.flatMap(p=>p.runs).find(r=>r.image?.hyperlink?.target===target).image;
  expect(image.hyperlink).toMatchObject({sourceId:'probeOuter',retainedTarget:true});expect(openableHyperlink(image.hyperlink)).toBe(false);
});
