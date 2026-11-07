import { beforeAll, afterAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

import { JSDOM } from 'jsdom';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });

const source = readFileSync('public/fixtures/editor-ux.docx');
const model = pkg => new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
const save = async (pkg, doc) => new Uint8Array(await pkg.export(doc.paragraphs, doc.pageSettings, doc.numbering, doc.styles, doc.tables, doc.assets).arrayBuffer());

it('changes both Latin slots in one undo step while retaining script fonts, theme parts and unrelated runs', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg), original = unzipSync(source);
  const at = doc.text.indexOf('Choose this font éΩ'); doc.select(at, at + 'Choose this font éΩ'.length);
  const before = doc.runFormatting;
  doc.setRunFormat({ fontAscii: 'Oswald', fontHAnsi: 'Oswald' });
  expect(doc.history).toHaveLength(1);
  expect(doc.runFormatting).toMatchObject({ fontAscii: 'Oswald', fontHAnsi: 'Oswald', fontEastAsia: before.fontEastAsia, fontCs: before.fontCs });
  const bytes = await save(pkg, doc), parts = unzipSync(bytes), reopened = model(await DocxPackage.open(bytes));
  reopened.select(...doc.range); expect(reopened.runFormatting).toEqual(doc.runFormatting);
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const W = xml.documentElement.namespaceURI;
  const run = [...xml.getElementsByTagNameNS(W, 'r')].find(r => r.textContent === 'Choose this font éΩ');
  const fonts = run.getElementsByTagNameNS(W, 'rFonts')[0];
  expect(fonts.getAttributeNS(W, 'asciiTheme')).toBeNull(); expect(fonts.getAttributeNS(W, 'hAnsiTheme')).toBeNull();
  expect(fonts.getAttributeNS(W, 'eastAsia')).toBe('Noto Sans'); expect(fonts.getAttributeNS(W, 'cs')).toBe('Noto Sans');
  for (const [name, bytes] of Object.entries(original)) if (name !== 'word/document.xml') expect(Buffer.from(parts[name]).equals(Buffer.from(bytes)), name).toBe(true);
  doc.undo(); expect(doc.runFormatting).toEqual(before);
  const undone = unzipSync(await save(pkg, doc));
  for (const [name, bytes] of Object.entries(original)) expect(Buffer.from(undone[name]).equals(Buffer.from(bytes)), name).toBe(true);
});

it('keeps a caret font choice for subsequent typing and round trips the authored text', async () => {
  const pkg = await DocxPackage.open(source), doc = model(pkg);
  doc.select(doc.text.indexOf('Body text')); doc.setRunFormat({ fontAscii: 'Open Sans', fontHAnsi: 'Open Sans' });
  doc.replace('New éΩ ');
  const reopened = model(await DocxPackage.open(await save(pkg, doc)));
  expect(reopened.paragraphs.flatMap(p => p.runs).find(r => r.text.startsWith('New éΩ '))).toMatchObject({ fontAscii: 'Open Sans', fontHAnsi: 'Open Sans' });
});
