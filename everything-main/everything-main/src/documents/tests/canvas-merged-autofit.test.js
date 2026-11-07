import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { TextDocument } from '../src/engine/model.js';
import { autoColumnWidths } from '../src/engine/tables.js';
import { layoutDocument, caretRect, hitTest } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';
import { fontMetrics } from '../src/engine/font-metrics.js';
let dom;
beforeAll(() => { dom = new JSDOM(); globalThis.DOMParser = dom.window.DOMParser; globalThis.XMLSerializer = dom.window.XMLSerializer; });
afterAll(() => dom.window.close());
const source = readFileSync('public/fixtures/merged-autofit.docx');
const model = p => new TextDocument(p.paragraphs, p.pageSettings, p.numbering, p.styles, p.tables, p.assets);
const measure = (text, style) => ({ ...fontMetrics(style), width: [...text].length * style.fontSize * 2 / 3 });
const layout = d => layoutDocument(d.paragraphs, measure, pageGeometry(d.pageSettings), d.numbering, d.tables);
const save = async (p, d) => new Uint8Array(await p.export(d.paragraphs, d.pageSettings, d.numbering, d.styles, d.tables, d.assets).arrayBuffer());
const preferred = grid => ({ grid, width: { type: 'dxa', value: grid.reduce((a, b) => a + b, 0) }, rows: [{ cells: grid.map(value => ({ width: { type: 'dxa', value } })) }] });
const metrics = grid => grid.map(() => ({ min: 100, max: 100, floor: 50 }));

it.each([
 [[1000, 1000, 1000], [{ column: 1, span: 2, min: 1900, max: 2400, floor: 100 }]],
 [[900, 1400, 700, 2100], [{ column: 1, span: 2, min: 1900, max: 2400, floor: 100 }]],
 [[1000, 1000, 1000], [{ column: 0, span: 2, min: 1900, max: 2400, floor: 100 }, { column: 1, span: 2, min: 1900, max: 2400, floor: 100 }]],
])('preserves feasible preferred grid %j despite merged interval minimums', (grid, spans) => {
 for (const scale of [.5, 1, 3]) {
  const values = grid.map(w => w * scale), intrinsic = metrics(grid).map(c => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v * scale])));
  const constraints = spans.map(s => ({ ...s, min: s.min * scale, max: s.max * scale, floor: s.floor * scale }));
  const widths = autoColumnWidths(preferred(values), 20000, intrinsic, 20000, constraints);
  widths.forEach((w, i) => expect(w).toBeCloseTo(values[i], 8));
 }
});
it('redistributes at the final width, expands when needed, and falls back to grapheme floors only at page capacity', () => {
 const grid = [1000, 1000, 1000], spans = [{ column: 0, span: 2, min: 2600, max: 4000, floor: 200 }, { column: 1, span: 2, min: 2600, max: 4000, floor: 200 }];
 for (const limit of [3000, 2200, 250]) {
  const widths = autoColumnWidths(preferred(grid), 5000, metrics(grid), limit, spans), key = limit < 2700 ? 'floor' : 'min';
  expect(widths.reduce((a, b) => a + b, 0)).toBeCloseTo(limit);
  for (const s of spans) expect(widths.slice(s.column, s.column + s.span).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(s[key] - 1e-6);
 }
 expect(() => autoColumnWidths(preferred(grid), 100, metrics(grid), 100, spans)).toThrow(/cannot fit/);
 const large = [{ column: 0, span: 3, min: 4200, max: 4500, floor: 300 }];
 expect(autoColumnWidths(preferred(grid), 5000, metrics(grid), 5000, large).reduce((a, b) => a + b, 0)).toBeCloseTo(4200);
});
it('round-trips independent staggered spans, reflows long edits and restores layout and package bytes on undo', async () => {
 const p = await DocxPackage.open(source), d = model(p), before = layout(d);
 for (const table of d.tables) before.tableWidths[table.id].forEach((w, i) => expect(w).toBeCloseTo(table.grid[i] / 15));
 const at = d.text.indexOf('x'.repeat(20)); d.select(at, at + 20); expect(d.clipboardText()).toBe('x'.repeat(20)); d.replace('W'.repeat(40));
 const changed = layout(d); expect(changed.tableWidths[d.tables[0].id]).not.toEqual(before.tableWidths[d.tables[0].id]);
 const caret = caretRect(changed, at + 5); expect(hitTest(changed, caret.page, caret.x, caret.y + caret.height / 2)).toBe(at + 5);
 const saved = await save(p, d), reopened = model(await DocxPackage.open(saved)); expect(reopened.text).toBe(d.text);
 expect(Object.values(layout(reopened).tableWidths)).toEqual(Object.values(changed.tableWidths)); expect(reopened.tables.map(t => t.grid)).toEqual(d.tables.map(t => t.grid));
 d.undo(); expect(layout(d)).toEqual(before); const out = unzipSync(await save(p, d)); for (const [name, bytes] of Object.entries(p.parts)) expect(Buffer.from(out[name]).equals(Buffer.from(bytes)), name).toBe(true);
});
it('keeps feasible preferences across varied overlapping intervals and mirrored grids', () => {
 for (let count = 3; count <= 9; count++) {
  for (const reverse of [false, true]) {
   let grid = Array.from({ length: count }, (_, i) => 300 + (i * 379 + count * 193) % 1700);
   if (reverse) grid = grid.reverse();
   const spans = [];
   for (let column = 0; column < count - 1; column++) for (let span = 2; span <= count - column; span++) {
    const width = grid.slice(column, column + span).reduce((a, b) => a + b, 0);
    spans.push({ column, span, min: width * .97, max: width * 1.2, floor: span * 50 });
   }
   autoColumnWidths(preferred(grid), 30000, metrics(grid), 30000, spans).forEach((w, i) => expect(w).toBeCloseTo(grid[i], 7));
  }
 }
});
