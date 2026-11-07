import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
let dom, bytes;
beforeAll(() => {
  dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  const parts = unzipSync(readFileSync('public/fixtures/nested-floating-borders.docx'));
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const body = xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'body')[0];
  [...body.children].forEach((node, i) => { if (node.localName !== 'sectPr' && i >= 3) node.remove(); });
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); bytes = zipSync(parts);
});
afterAll(() => dom.window.close());
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const render = d => layoutDocument(d.paragraphs, text => ({ width: text.length * 5, ascent: 12, descent: 4 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const border = { style: 'single', size: 24, color: '000000' };

it('repositions centered child tables after border edits and retains borders, positioning and exact undo', async () => {
  const p = await DocxPackage.open(bytes), d = model(p), child = d.tables.find(t => t.floating);
  const before = render(d), x = before.floatingTables[0].left;
  d.selectCell(child.rows[1].cells[0].id); d.setCellBorders({ right: border });
  const changed = render(d);
  // Native cases 0 and 6 move the centered frame left by 0.36pt.
  expect(Math.abs((changed.floatingTables[0].left - x) * .75 + .36)).toBeLessThan(.04);
  const output = await save(p, d), parts = unzipSync(output), original = unzipSync(bytes);
  for (const name of Object.keys(original)) if (name !== 'word/document.xml') expect(parts[name], name).toEqual(original[name]);
  const reopened = model(await DocxPackage.open(output));
  expect(reopened.tables.find(t => t.floating).floating).toEqual(child.floating);
  expect(reopened.tables.find(t => t.floating).rows[1].cells[0].borders.right).toMatchObject(border);
  expect(render(reopened).floatingTables[0].left).toBe(changed.floatingTables[0].left);
  d.undo(); expect(render(d)).toEqual(before); expect(unzipSync(await save(p, d))).toEqual(original);
  d.redo(); expect(render(d)).toEqual(changed);
}, 60000);

it('distinguishes a later-row left border from the first-row left border when aligning the frame', async () => {
  const d = model(await DocxPackage.open(bytes)), child = d.tables.find(t => t.floating), x = render(d).floatingTables[0].left;
  d.selectCell(child.rows[1].cells[0].id); d.setCellBorders({ left: border });
  expect(render(d).floatingTables[0].left).toBe(x);
  d.undo(); d.selectCell(child.rows[0].cells[0].id); d.setCellBorders({ left: border });
  // Native cases 0 and 4 move both rows' text right by 0.72pt.
  expect(Math.abs((render(d).floatingTables[0].left - x) * .75 - .72)).toBeLessThan(.04);
}, 60000);
