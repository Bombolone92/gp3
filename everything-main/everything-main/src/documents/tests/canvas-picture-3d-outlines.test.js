import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = readFileSync('public/fixtures/picture-3d-outlines.docx');
const reference = JSON.parse(readFileSync('tests/fixtures/picture-3d-outlines/reference.json', 'utf8'));
const scenes = p => Object.values(p.assets).filter(a => a.scene).map(a => a.scene);
it('reads outline widths and preserves all seventeen pictures through edit/reopen/undo', async () => {
  expect(createHash('sha256').update(source).digest('hex')).toBe(reference.sourceSha256);
  const p = await DocxPackage.open(source), before = scenes(p);
  expect(before).toHaveLength(17);
  expect(before[0].outline).toEqual({ width: .75, color: '804020' });
  expect(before[3].outline).toEqual({ width: .75, color: '202060' });
  expect(before[9].outline).toBeNull(); expect(before[10].outline.width).toBe(8);
  const d = new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
  const save = async () => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
  d.select(0); d.replace('Edited '); expect(scenes(await DocxPackage.open(await save()))).toEqual(before);
  d.undo(); expect(unzipSync(await save())).toEqual(p.parts);
}, 30000);
it('resolves a themed outline through the package theme', async () => {
  const parts = unzipSync(source);
  const theme = new DOMParser().parseFromString(strFromU8(parts['word/theme/theme1.xml']), 'application/xml');
  const accent = theme.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/main', 'accent1')[0].firstElementChild.getAttribute('val');
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace('<a:srgbClr val="804020"/>', '<a:schemeClr val="accent1"/>'));
  expect(scenes(await DocxPackage.open(zipSync(parts)))[0].outline.color).toBe(accent);
});
it.each([
  ['<a:ln>', '<a:ln w="-1">'], ['<a:ln>', '<a:ln w="20116801">'],
  ['<a:ln>', '<a:ln w="0.75">'], ['<a:ln>', '<a:ln cmpd="dbl">'],
  ['<a:ln>', '<a:ln algn="in">'], ['<a:ln>', '<a:ln cap="invalid">'],
  ['</a:ln>', '<a:noFill/></a:ln>'], ['</a:ln>', '<a:miter lim="-1"/></a:ln>'],
  ['</a:ln>', '<a:prstDash val="dash"/></a:ln>'],
  ['</a:ln>', '<a:headEnd type="triangle"/></a:ln>'],
])('guards unsupported or malformed ordinary outlines: %s / %s', async (from, to) => {
  const parts = unzipSync(source), xml = strFromU8(parts['word/document.xml']); expect(xml).toContain(from);
  parts['word/document.xml'] = strToU8(xml.replace(from, to));
  await expect(DocxPackage.open(zipSync(parts))).rejects.toThrow();
});
