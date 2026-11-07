import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument, selectionRects } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { expectBodyEditParts } from './helpers/expect-body-edit-parts.js';
let dom, bytes;
beforeAll(() => {
  dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer;
  const parts = unzipSync(readFileSync('public/fixtures/nested-floating-tables.docx'));
  const xml = new DOMParser().parseFromString(strFromU8(parts['word/document.xml']), 'application/xml');
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = xml.getElementsByTagNameNS(w, 'body')[0];
  // Isolate the independently authored page-offset control, retaining settings,
  // styles, margins, relationships, and the complete nested table structure.
  [...body.children].forEach((node, i) => { if (node.localName !== 'sectPr' && Math.floor(i / 3) !== 1) node.remove(); });
  [...body.getElementsByTagNameNS(w, 'pageBreakBefore')].forEach(n => n.remove());
  parts['word/document.xml'] = strToU8(new XMLSerializer().serializeToString(xml)); bytes = zipSync(parts);
});
afterAll(() => dom.window.close());
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const render = d => layoutDocument(d.paragraphs, text => ({ width: text.length * 5, ascent: 12, descent: 4 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());

it('moves cell-relative floats with earlier body edits and retains source order, exports and exact undo', async () => {
  const p = await DocxPackage.open(bytes), d = model(p), before = render(d);
  expect(before.floatingTables).toHaveLength(1);
  d.select(0, d.paragraphs[0].runs.map(r => r.text).join('').length); d.replace('First line\nSecond line');
  const after = render(d);
  expect(after.floatingTables[0].top - before.floatingTables[0].top).toBeCloseTo(20);
  expect(after.lines.map(l => l.start)).toEqual(after.lines.map(l => l.start).sort((a, b) => a - b));
  const output = await save(p, d), parts = unzipSync(output), original = unzipSync(bytes);
  expectBodyEditParts(parts, original);
  const reopened = await DocxPackage.open(output);
  expect(reopened.tables.map(t => t.floating)).toEqual(p.tables.map(t => t.floating));
  const geometry = frames => frames.map(({ cellId, tableId, ...frame }) => frame);
  expect(geometry(render(model(reopened)).floatingTables)).toEqual(geometry(after.floatingTables));
  d.undo(); expect(unzipSync(await save(p, d))).toEqual(original); expect(render(d)).toEqual(before);
}, 60000);

it('clips a floating child when its parent becomes exact-height without losing editable source', async () => {
  const p = await DocxPackage.open(bytes), d = model(p), before = render(d);
  const outer = d.tables.find(t => !t.parentCellId);
  d.selectCell(outer.rows[0].cells[1].id); d.setTableRowHeight({ rule: 'exact', value: 900 });
  const clipped = render(d), floatingId = d.tables.find(t => t.floating).id;
  const cell = clipped.cells.find(c => c.tableId === floatingId), line = clipped.lines.find(l => l.cellId === cell.id);
  expect(cell.cellClip.bottom).toBeLessThan(cell.y);
  expect(line.cellClip.bottom).toBeLessThan(line.y);
  expect(selectionRects(clipped, line.start, line.end)).toEqual([]);
  expect(d.text).toContain('Nested text');
  const reopened = model(await DocxPackage.open(await save(p, d)));
  const reopenedId = reopened.tables.find(t => t.floating).id;
  expect(render(reopened).cells.find(c => c.tableId === reopenedId).cellClip).toEqual(cell.cellClip);
  d.undo(); expect(render(d)).toEqual(before);
  d.redo(); expect(render(d)).toEqual(clipped);
}, 60000);
