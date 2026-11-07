import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize * .8, descent: style.fontSize * .2 });

it('opens hidden text for editing, gives it no width and keeps it on save', async () => {
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    'word/document.xml': `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve">Shown </w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>secret</w:t></w:r><w:r><w:t xml:space="preserve"> text</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
  };
  const pkg = await DocxPackage.open(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
  expect(pkg.readOnly).toBeFalsy();
  const d = new TextDocument(pkg.paragraphs, pkg.pageSettings, pkg.numbering, pkg.styles, pkg.tables, pkg.assets);
  expect(d.text).toBe('Shown secret text');
  const placed = layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables, undefined, { styles: d.styles });
  const visible = placed.lines[0].fragments.map(f => f.text).join('');
  expect(visible).toBe('Shown  text');
  d.select(d.text.length); d.replace('!');
  const xml = strFromU8(unzipSync(new Uint8Array(await pkg.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer()))['word/document.xml']);
  expect(xml).toMatch(/<w:vanish\/>[\s\S]*secret/);
});
