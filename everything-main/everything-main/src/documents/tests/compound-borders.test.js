import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { borderWidth } from '../src/engine/paragraph-borders.js';
import { tableBorderWidth, winningTableBorder } from '../src/engine/table-border-layout.js';
import { paintParagraphBorder } from '../src/engine/canvas-paragraph-borders.js';

let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const border = size => ({ style: 'thinThickLargeGap', size, space: 0, color: '000000' });
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const layout = d => layoutDocument(d.paragraphs, (text, s) => ({ width: text.length * s.fontSize * 2 / 3, ascent: s.fontSize, descent: s.fontSize / 3 }), pageGeometry(d.pageSettings), d.numbering, d.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const sameParts = (bytes, parts) => { const out = unzipSync(bytes); expect(Object.keys(out).sort()).toEqual(Object.keys(parts).sort()); for (const [name, data] of Object.entries(parts)) expect(Buffer.from(out[name]).equals(Buffer.from(data)), name).toBe(true); };

// Measured native reference PDF gaps, in points; retained references include all four sides
// in both paragraphs and tables. Values are observations, not renderer output.
it.each([[0,.12],[2,.24],[8,.96],[11,1.32],[12,1.44],[13,1.56],[17,2.04],[24,3],[48,6],[96,12]])('matches the native reference compound ink and gap at size %s', (size, gap) => {
 const edge = border(size), width = (1.44 + .72 + gap) * 4 / 3;
 expect(borderWidth(edge)).toBeCloseTo(width); expect(tableBorderWidth(edge)).toBeCloseTo(width);
 for (const horizontal of [true, false]) {
  const boxes = [], ctx = { save(){}, restore(){}, fillRect(...box){ boxes.push(box); } };
  paintParagraphBorder(ctx, { x: 10, y: 20, width: horizontal ? 100 : width, height: horizontal ? width : 100, horizontal, border: edge });
  expect(boxes).toHaveLength(2);
  expect(boxes[0][horizontal ? 3 : 2]).toBeCloseTo(1.44 * 4 / 3);
  expect(boxes[1][horizontal ? 3 : 2]).toBeCloseTo(.72 * 4 / 3);
  const axis = horizontal ? 1 : 0;
  expect(boxes[1][axis] - boxes[0][axis] - boxes[0][horizontal ? 3 : 2]).toBeCloseTo(gap * 4 / 3);
 }
});

it.each(['controls','edges','frame'])('imports original %s, lays out both contexts and preserves editable OPC round trips', async name => {
 const p = await DocxPackage.open(readFileSync(`public/fixtures/compound-border-${name}.docx`)), d = model(p), before = layout(d);
 expect(d.tables).toHaveLength(name === 'edges' ? 6 : 4);
 expect(before.paragraphBorders.length).toBeGreaterThan(0); expect(before.tableBorders.filter(b => !b.guide).length).toBeGreaterThan(0);
 sameParts(await save(p, d), p.parts);
 d.selectCell(d.tables[0].rows[0].cells[0].id); d.setCellBorders({ top: border(13) });
 const reopened = model(await DocxPackage.open(await save(p, d)));
 expect(reopened.tables[0].rows[0].cells[0].borders.top).toMatchObject(border(13));
 expect(layout(reopened).pageCount).toBe(layout(d).pageCount);
 d.undo(); expect(layout(d)).toEqual(before); sameParts(await save(p, d), p.parts);
 const target = d.paragraphs.find(p => p.format.paragraphBorders?.top?.style === 'thinThickLargeGap');
 const index = d.paragraphs.indexOf(target), at = d.paragraphs.slice(0,index).reduce((n,p) => n + p.runs.reduce((n,r) => n + r.text.length,0) + 1,0);
 d.select(at,at); d.setParagraphFormat({ paragraphBorders: { top: border(0) } });
 const again = model(await DocxPackage.open(await save(p,d)));
 expect(again.paragraphs[index].format.paragraphBorders.top).toMatchObject(border(0));
 d.undo(); sameParts(await save(p,d),p.parts);
});

it('matches the native reference frame reversal on bottom/right paragraph and table borders', async () => {
 const d = model(await DocxPackage.open(readFileSync('public/fixtures/compound-border-frame.docx'))), result = layout(d);
 for (const stroke of [...result.paragraphBorders, ...result.tableBorders.filter(b => !b.guide)]) {
  expect(stroke.border.frame).toBe(true); expect(['top','left','bottom','right']).toContain(stroke.side);
  const boxes = [], ctx = { save(){}, restore(){}, fillRect(...box){ boxes.push(box); } };
  paintParagraphBorder(ctx, { ...stroke, clip: undefined });
  const reverse = ['bottom','right'].includes(stroke.side), axis = stroke.horizontal ? 3 : 2;
  if (stroke.bodyBands) { expect(boxes.every(box => Math.abs(box[axis] - .96) < 1e-6 || Math.abs(box[axis] - 1.92) < 1e-6)).toBe(true); continue; }
  expect(boxes[0][axis]).toBeCloseTo(reverse ? .96 : 1.92);
  expect(boxes[1][axis]).toBeCloseTo(reverse ? 1.92 : .96);
 }
});

it('resolves compound shared edges with the documented border weight and tie precedence', () => {
 const edge = (style,size) => ({ border: {...border(size),style}, background:'#FFFFFF',order:0 });
 const compound = edge('thinThickLargeGap',2);
 expect(winningTableBorder(compound,edge('single',33))).toBe(compound);
 const equal = edge('single',34); expect(winningTableBorder(compound,equal)).toBe(equal);
 const larger = edge('single',35); expect(winningTableBorder(compound,larger)).toBe(larger);
 expect(winningTableBorder(edge('none',0),edge('thinThickLargeGap',0)).border.style).toBe('thinThickLargeGap');
});
