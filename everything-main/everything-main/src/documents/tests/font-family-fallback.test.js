import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = () => unzipSync(readFileSync('public/fixtures/font-family-fallback.docx'));
it('uses the native family fallback without replacing original font declarations', async () => {
  const pkg = await DocxPackage.open(zipSync(source()));
  const expected = ['Calibri', 'Cambria', 'Calibri', 'Calibri', 'Calibri', 'Calibri', 'Calibri', 'Cambria', 'Calibri', ['Codex Absent Alternative', 'Calibri'], 'Calibri', ['Codex Missing Face 012', 'Calibri']];
  for (let i = 0; i < expected.length; i++) {
    const name = `Codex Missing Face ${String(i + 1).padStart(3, '0')}`;
    expect(pkg.styles.fontAlternatives[name.toLowerCase()]).toEqual(expected[i]);
    expect(pkg.paragraphs[i].runs[0].fontAscii).toBe(name);
  }
});
it('does not apply the Latin fallback to symbol or non-Latin charset declarations', async () => {
  for (const charset of ['02', '80', 'CC']) {
    const parts = source();
    const xml = new DOMParser().parseFromString(strFromU8(parts['word/fontTable.xml']), 'application/xml');
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const font = [...xml.documentElement.children].find(n => n.getAttributeNS(ns, 'name') === 'Codex Missing Face 001');
    const declaration = xml.createElementNS(ns, 'w:charset'); declaration.setAttributeNS(ns, 'w:val', charset); font.prepend(declaration);
    parts['word/fontTable.xml'] = strToU8(new XMLSerializer().serializeToString(xml));
    const pkg = await DocxPackage.open(zipSync(parts));
    expect(pkg.styles.fontAlternatives['codex missing face 001']).toBeUndefined();
  }
});
it('binds native family choices and theme independence to original source/PDF hashes', () => {
  const refs = JSON.parse(readFileSync('tests/fixtures/font-family-fallback/reference.json'));
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const [name, ref] of Object.entries(refs)) {
    expect(hash(readFileSync(`public/fixtures/${name}.docx`))).toBe(ref.sourceSha256);
    expect(hash(readFileSync(`tests/fixtures/font-family-fallback/${name}-native.pdf`))).toBe(ref.pdfSha256);
  }
  expect(refs['font-family-fallback-base'].rows.map(r => r.font)).toEqual(refs['font-family-fallback-theme'].rows.map(r => r.font));
  expect(refs['font-family-fallback'].rows.slice(0, 9).map(r => r.font)).toEqual(['Calibri', 'Cambria', 'Calibri', 'Calibri', 'Calibri', 'Calibri', 'Calibri', 'Cambria', 'Calibri']);
  expect(refs['font-family-fallback'].rows[10].font).toBe('Calibri');
  expect(refs['font-family-fallback'].rows[11].font).toBe('Calibri');
});
it('keeps explicit alternatives ahead of duplicate family metadata and avoids ambiguous implicit choices', async () => {
  for (const [markup, expected] of [['<w:altName w:val="Arial"/>', ['Arial', 'Calibri']], ['<w:family w:val="roman"/>', undefined], ['<w:family w:val="auto"/>', 'Calibri']]) {
    const parts = source();
    parts['word/fontTable.xml'] = strToU8(strFromU8(parts['word/fontTable.xml']).replace('</w:fonts>', `<w:font w:name="Codex Missing Face 001">${markup}</w:font></w:fonts>`));
    const pkg = await DocxPackage.open(zipSync(parts));
    expect(pkg.styles.fontAlternatives['codex missing face 001']).toEqual(expected);
  }
});
