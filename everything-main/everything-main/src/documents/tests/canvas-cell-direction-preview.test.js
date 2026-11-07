import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(''); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
const source = () => new Uint8Array(readFileSync('tests/fixtures/cell-text-direction/control.docx'));
const measure = text => ({ width: text.length * 6, ascent: 10, descent: 3 });
const layout = (pkg, options = { bestEffort: true }, metrics = measure) => layoutDocument(pkg.paragraphs, metrics, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, options);
const cells = pkg => pkg.tables.flatMap(table => table.rows.flatMap(row => row.cells));

it('imports supported quarter-turn directions without forcing read-only mode', async () => {
  const bytes = source();
  const pkg = await DocxPackage.open(bytes);
  expect(!!pkg.readOnly).toBe(false);
  expect(cells(pkg).map(cell => cell.textDirection)).toEqual(Array.from({ length: 8 }, () => ['lrTb', 'btLr', 'tbRl']).flat());
  expect(layout(pkg).lines.some(line => line.cellText)).toBe(true);
  expect(pkg.parts).toEqual(unzipSync(bytes));
});

it('falls back only for unsupported rotated structures without changing the source model', async () => {
  const parts = unzipSync(source());
  parts['word/document.xml'] = strToU8(strFromU8(parts['word/document.xml']).replace(/(<w:textDirection w:val="btLr"\/>\s*<w:vAlign[^>]*\/>)/, '$1<w:hideMark/>'));
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(() => layout(pkg, {})).toThrow(/Hidden terminal marks/);
  const result = layout(pkg);
  expect(result.rotatedCellApproximations).toHaveLength(1);
  expect(result.rotatedCellApproximations[0].reason).toMatch(/Hidden terminal marks/);
  expect(result.lines.some(line => line.cellText)).toBe(true);
  expect(result.lines.filter(line => line.cellId === cells(pkg)[1].id).every(line => !line.cellText)).toBe(true);
  expect(cells(pkg)[1].textDirection).toBe('btLr');
  expect(pkg.parts).toEqual(parts);
  expect(() => layout(pkg, { bestEffort: true }, () => { throw new Error('measurement failure'); })).toThrow('measurement failure');
});

it('ignores table-style directions while retaining a direct horizontal override', async () => {
  const parts = unzipSync(source()), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  for (const node of [...doc.getElementsByTagNameNS(W, 'textDirection')]) node.remove();
  const pr = doc.getElementsByTagNameNS(W, 'tblPr')[0];
  const style = doc.createElementNS(W, 'w:tblStyle'); style.setAttributeNS(W, 'w:val', 'Rotation'); pr.prepend(style);
  const look = doc.createElementNS(W, 'w:tblLook'); look.setAttributeNS(W, 'w:firstRow', '1'); pr.append(look);
  const override = doc.createElementNS(W, 'w:textDirection'); override.setAttributeNS(W, 'w:val', 'lrTb');
  doc.getElementsByTagNameNS(W, 'tcPr')[2].append(override);
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(doc));
  parts['word/styles.xml'] = strToU8(strFromU8(parts['word/styles.xml']).replace('</w:styles>', '<w:style w:type="table" w:styleId="Rotation"><w:name w:val="Rotation"/><w:tcPr><w:textDirection w:val="btLr"/></w:tcPr><w:tblStylePr w:type="firstRow"><w:tcPr><w:textDirection w:val="tbRl"/></w:tcPr></w:tblStylePr></w:style></w:styles>'));
  const pkg = await DocxPackage.open(zipSync(parts), { bestEffort: true });
  expect(!!pkg.readOnly).toBe(false);
  expect(cells(pkg).slice(0, 3).map(cell => cell.textDirection)).toEqual([undefined, undefined, 'lrTb']);
  expect(pkg.parts).toEqual(parts);
});
