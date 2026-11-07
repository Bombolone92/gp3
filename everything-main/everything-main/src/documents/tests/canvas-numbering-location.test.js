import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { listMarkers } from '../src/engine/numbering.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = () => unzipSync(readFileSync('public/fixtures/numbering-location.docx'));
const rel = 'word/_rels/document.xml.rels', path = 'lists/numbering2.xml';
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles);
const save = async (p,d) => unzipSync(new Uint8Array(await p.export(d.paragraphs,d.pageSettings,d.numbering,d.styles).arrayBuffer()));
const labels = d => listMarkers(d.paragraphs,d.numbering).map(m=>m?.text);

it.each(['../lists/numbering2.xml','/lists/numbering2.xml','../lists/./numbering2.xml','../../lists/numbering2.xml'])('resolves %s and preserves edits/restarts/undo in the related part', async target => {
  const parts = source(); parts[rel] = strToU8(strFromU8(parts[rel]).replace('../lists/numbering2.xml',target));
  parts['word/numbering.xml'] = strToU8('<unrelated/>');
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  expect(labels(doc)).toEqual(['4.','5.']); expect(await save(pkg,doc)).toEqual(parts);
  doc.select(0); doc.replace('Edited '); expect((await save(pkg,doc))[path]).toEqual(parts[path]);
  doc.select(doc.text.indexOf('Second')); doc.restartNumbering(); expect(labels(doc)).toEqual(['4.','1.']);
  const edited = await save(pkg,doc), reopened = model(await DocxPackage.open(zipSync(edited)));
  expect(labels(reopened)).toEqual(['4.','1.']); expect(reopened.text).toBe('Edited First item\nSecond item');
  expect(Object.keys(edited).sort()).toEqual(Object.keys(parts).sort());
  for(const name of Object.keys(parts)) if (![path,'word/document.xml'].includes(name)) expect(edited[name]).toEqual(parts[name]);
  doc.undo(); doc.undo(); expect(await save(pkg,doc)).toEqual(parts);
});

it.each(['missing.xml','https://example.com/n.xml','../lists/numbering2.xml#x','../lists/numbering2.xml?q','../lists/%2fn.xml'])('rejects invalid numbering target %s before editing',async target=>{
  const parts=source();parts[rel]=strToU8(strFromU8(parts[rel]).replace('../lists/numbering2.xml',target));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/numbering/);
});

it('preserves an unrelated conventional part when authoring a new list',async()=>{
  const parts=source(); parts['word/numbering.xml']=strToU8('<unrelated/>');
  parts[rel]=strToU8(strFromU8(parts[rel]).replace(/<Relationship Id="numbers"[^>]*\/>/,''));
  parts['word/document.xml']=strToU8(strFromU8(parts['word/document.xml']).replace(/<w:numPr>.*?<\/w:numPr>/g,''));
  const pkg=await DocxPackage.open(zipSync(parts)),doc=model(pkg);
  doc.select(0);doc.toggleList('number');
  const edited=await save(pkg,doc);
  expect(edited['word/numbering.xml']).toEqual(parts['word/numbering.xml']);expect(edited[path]).toEqual(parts[path]);
  expect(edited['word/numbering1.xml']).toBeDefined();
  expect(labels(model(await DocxPackage.open(zipSync(edited))))[0]).toBe('1.');
});
