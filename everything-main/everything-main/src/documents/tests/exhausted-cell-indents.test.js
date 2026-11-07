import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { paragraphEdges } from '../src/engine/paragraph-geometry.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => { dom.window.close(); delete globalThis.DOMParser; delete globalThis.XMLSerializer; });
it('lays out each exhausted-cell item, including spaces and tiny glyphs, on its own line', async () => {
  const pkg = await DocxPackage.open(readFileSync('public/fixtures/exhausted-cell-indents.docx'));
  const result = layoutDocument(pkg.paragraphs, (t,s) => ({ width:t.length*s.fontSize*1.1, ascent:s.fontSize, descent:s.fontSize/3 }), pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables);
  const expected = [1,1,5,1,1,2,2,5,1,2,2,2,4,4];
  for (const [index,row] of pkg.tables[0].rows.entries()) {
    const cell = row.cells[1], lines = result.lines.filter(l => l.cellId === cell.id);
    expect(lines, `row ${index}`).toHaveLength(expected[index]);
    for (const line of lines) {
      expect(Number.isFinite(line.baseline)).toBe(true);
      expect(line.height).toBeGreaterThan(0);
    }
  }
});
it('preserves positive subpixel cell widths and does not relax body geometry validation', () => {
  const format = { indentLeft:0, indentRight:0, firstLine:0 };
  const page = { width:100, left:20, right:79.75, tableDepth:1 };
  expect(paragraphEdges(format,page,true)).toEqual({left:20,right:20.25});
  expect(paragraphEdges({...format,indentLeft:15},page,true)).toEqual({left:21,right:21});
  expect(() => paragraphEdges(format,{...page,tableDepth:0},true)).toThrow(/no writing space/);
});
