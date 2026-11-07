import { beforeAll, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';

beforeAll(() => { const w = new JSDOM('').window; globalThis.DOMParser = w.DOMParser; globalThis.XMLSerializer = w.XMLSerializer; });
const source = () => unzipSync(readFileSync('public/fixtures/styles-location.docx'));
const rel = 'word/_rels/document.xml.rels', style = 'format/styles2.xml';
const save = async (p, d) => unzipSync(new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables).arrayBuffer()));
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);

it.each(['../format/styles2.xml', '/format/styles2.xml', '../format/./styles2.xml', '../../format/styles2.xml'])('resolves %s, preserves styles through text edits and writes shared-style changes in place', async target => {
  const parts = source(); parts[rel] = strToU8(strFromU8(parts[rel]).replace('../format/styles2.xml', target));
  // A conventional-looking unrelated part must not override the relationship.
  parts['word/styles.xml'] = strToU8('<unrelated/>');
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  expect(doc.paragraphs[0].runs[0]).toMatchObject({ bold: true, fontSize: 16 });
  expect(doc.paragraphs[1].runs[0].italic).toBe(true);
  expect(await save(pkg, doc)).toEqual(parts);
  doc.select(0); doc.replace('New ');
  const textEdit = await save(pkg, doc); expect(textEdit[style]).toEqual(parts[style]);
  doc.editParagraphStyle('Body', { run: { fontSize: 21 } });
  const edited = await save(pkg, doc);
  expect(Object.keys(edited).sort()).toEqual(Object.keys(parts).sort());
  for (const name of Object.keys(parts)) if (![style, 'word/document.xml'].includes(name)) expect(edited[name]).toEqual(parts[name]);
  const reopened = await DocxPackage.open(zipSync(edited));
  expect(reopened.paragraphs[0].runs[0].fontSize).toBe(21);
  expect(reopened.paragraphs[1].runs[0].italic).toBe(true);
  doc.undo(); doc.undo(); expect(await save(pkg, doc)).toEqual(parts);
});

it.each(['https://example.com/styles.xml', '//example.com/styles.xml', 'missing.xml', '../format/styles2.xml#fragment', '../format/styles2.xml?query', '../format/%2fstyles.xml'])('rejects invalid or missing style target %s before editing', async target => {
  const parts = source(); parts[rel] = strToU8(strFromU8(parts[rel]).replace('../format/styles2.xml', target));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/styles/);
});

it.each(['External', 'Bogus'])('rejects %s relationship mode', async mode => {
  const parts = source(); parts[rel] = strToU8(strFromU8(parts[rel]).replace('Target=', `TargetMode="${mode}" Target=`));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/styles relationships/);
});

it('rejects multiple main-document styles relationships', async () => {
  const parts = source(), text = strFromU8(parts[rel]);
  parts[rel] = strToU8(text.replace('</Relationships>', text.match(/<Relationship Id[^>]+\/>/)[0].replace('Id="styles"', 'Id="other"') + '</Relationships>'));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow(/styles relationships/);
});

it('ignores an unrelated conventional styles part and preserves it when creating a style', async () => {
  const parts = source(); parts['word/styles.xml'] = strToU8('<unrelated/>');
  parts[rel] = strToU8(strFromU8(parts[rel]).replace(/<Relationship Id[^>]+\/>/, ''));
  const pkg = await DocxPackage.open(zipSync(parts)), doc = model(pkg);
  expect(doc.paragraphs[0].runs[0].bold).toBe(false);
  doc.select(0); doc.createParagraphStyle('New style', ''); doc.editParagraphStyle(doc.paragraphStyle, { run: { fontSize: 22 } });
  const edited = await save(pkg, doc);
  expect(edited['word/styles.xml']).toEqual(parts['word/styles.xml']); expect(edited[style]).toEqual(parts[style]);
  expect(edited['word/styles1.xml']).toBeDefined();
  expect((await DocxPackage.open(zipSync(edited))).paragraphs[0].runs[0].fontSize).toBe(22);
});
