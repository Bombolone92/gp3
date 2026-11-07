import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { decodeEmbeddedFont, documentEmbeddedFonts } from '../src/engine/embedded-fonts.js';
const type = 'application/vnd.openxmlformats-officedocument.obfuscatedFont';
const key = '{00112233-4455-6677-8899-AABBCCDDEEFF}';
const source = name => unzipSync(readFileSync(`tests/fixtures/embedded-fonts/${name}.docx`));
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
it('decodes the complete reversed GUID twice without changing source bytes', () => {
  const bytes = source('four-faces')['word/fonts/face0.odttf'], before = bytes.slice();
  expect(decodeEmbeddedFont(bytes, key, type).data).toEqual(new Uint8Array(readFileSync('public/fonts/SourceSansPro-Regular.ttf')));
  expect(bytes).toEqual(before);
  for (const bad of [null, '', key.slice(1), '{ffffffff-ffff-ffff-ffff-ffffffffffff}']) expect(decodeEmbeddedFont(bytes, bad, type)).toBeNull();
  expect(decodeEmbeddedFont(new Uint8Array(), key, type)).toBeNull();
  expect(decodeEmbeddedFont(bytes, key, 'application/x-fontdata')).toBeNull();
});
it('retains declarations, all embedded parts, edits and exact undo independently of aliases', async () => {
  const parts = source('four-faces'), pkg = await DocxPackage.open(zipSync(parts));
  const model = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  const save = () => pkg.exportBodyParts(model.paragraphs, model.pageSettings, model.numbering, model.styles, model.tables, model.assets);
  const same = actual => { expect(Object.keys(actual).sort()).toEqual(Object.keys(parts).sort()); for (const name of Object.keys(parts)) expect(Buffer.from(actual[name]).equals(Buffer.from(parts[name])), name).toBe(true); };
  same(save());
  expect(model.paragraphs[0].runs[0].fontAscii).toBe('Codex Embedded Fixture');
  model.replace('EDIT ');
  const edited = save(); for (const name of Object.keys(parts)) if (name !== 'word/document.xml') expect(Buffer.from(edited[name]).equals(Buffer.from(parts[name])), name).toBe(true);
  expect(strFromU8(edited['word/document.xml'])).not.toContain('Canvas embedded');
  model.undo(); same(save());
});
it('isolates different embedded faces with the same declared name and reuses identical content', () => {
  const a = documentEmbeddedFonts(source('four-faces')).get('codex embedded fixture');
  expect(documentEmbeddedFonts(source('four-faces')).get('codex embedded fixture')).toBe(a);
  expect(documentEmbeddedFonts(source('second-family')).get('codex embedded fixture')).not.toBe(a);
  expect(documentEmbeddedFonts(source('raw-font')).get('codex embedded fixture')).toBe(a);
});
it.each([
  ['external', xml => xml.replace('Target="fonts/face0.odttf"', 'Target="https://example.invalid/font.ttf" TargetMode="External"')],
  ['wrong relationship type', xml => xml.replaceAll('/relationships/font', '/relationships/image')],
  ['escape', xml => xml.replaceAll('fonts/face', '../../../face')],
  ['duplicate relationship', xml => xml.replace('</Relationships>', xml.match(/<Relationship Id="font0"[^>]+\/>/)[0] + '</Relationships>')],
])('ignores an unusable %s font reference while preserving remaining faces', (name, mutate) => {
  const parts = source('four-faces');
  parts['word/_rels/fontTable.xml.rels'] = strToU8(mutate(strFromU8(parts['word/_rels/fontTable.xml.rels'])));
  const fonts = documentEmbeddedFonts(parts);
  if (['wrong relationship type', 'escape'].includes(name)) expect(fonts.size).toBe(0);
  else expect(fonts.get('codex embedded fixture')).toMatch(/^Canvas embedded font /);
});
it('resolves encoded internal paths against the font-table part, not the main document', () => {
  const parts = source('raw-font');
  parts['word/nested/table.xml'] = parts['word/fontTable.xml']; delete parts['word/fontTable.xml'];
  parts['word/nested/_rels/table.xml.rels'] = strToU8(strFromU8(parts['word/_rels/fontTable.xml.rels']).replaceAll('fonts/face', '../fonts/%66ace'));
  parts['word/_rels/document.xml.rels'] = strToU8(strFromU8(parts['word/_rels/document.xml.rels']).replace('fontTable.xml', 'nested/table.xml'));
  expect(documentEmbeddedFonts(parts).get('codex embedded fixture')).toBe(documentEmbeddedFonts(source('raw-font')).get('codex embedded fixture'));
});
it('does not let an empty bold part discard a valid regular embedded face', () => {
  expect(documentEmbeddedFonts(source('empty-bold')).get('codex embedded fixture')).toMatch(/^Canvas embedded font /);
});
it('does not create an undefined fallback for ambiguous non-Latin font declarations', async () => {
  const parts = source('four-faces');
  let xml = strFromU8(parts['word/fontTable.xml']).replace(/<w:altName[^>]+\/>/, '<w:charset w:val="80"/>');
  xml = xml.replace('</w:fonts>', xml.match(/<w:font w:name[\s\S]*<\/w:font>/)[0] + '</w:fonts>');
  parts['word/fontTable.xml'] = strToU8(xml);
  const pkg = await DocxPackage.open(zipSync(parts));
  expect(pkg.styles.fontAlternatives).toBeUndefined();
});
it('honors outline embedding permissions and distinguishes preview-only from editable data', () => {
  const original = new Uint8Array(readFileSync('public/fonts/SourceSansPro-Regular.ttf'));
  const v = new DataView(original.buffer); let at;
  for (let i = 0; i < v.getUint16(4); i++) if (v.getUint32(12 + 16 * i) === 0x4f532f32) at = v.getUint32(20 + 16 * i) + 8;
  for (const [flags, expected] of [[0, false], [4, true], [8, false], [12, false], [2, null], [0x200, null]]) {
    v.setUint16(at, flags);
    const face = decodeEmbeddedFont(original, '{00000000-0000-0000-0000-000000000000}', 'application/x-font-ttf');
    if (expected === null) expect(face).toBeNull(); else expect(face.previewOnly).toBe(expected);
  }
});
