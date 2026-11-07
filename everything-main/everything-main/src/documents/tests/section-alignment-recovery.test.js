import { beforeAll, afterAll, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { DocxPackage } from '../src/engine/docx.js';
import { layoutDocument } from '../src/engine/layout.js';
import { pageGeometry } from '../src/engine/page-settings.js';

let dom;
beforeAll(() => { dom = new JSDOM(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) globalThis[name] = dom.window[name]; });
afterAll(() => { dom.window.close(); for (const name of ['Node', 'document', 'DOMParser', 'XMLSerializer']) delete globalThis[name]; });
const source = name => readFileSync(`tests/fixtures/section-alignment-recovery/${name}.docx`);
const measure = (text, style) => ({ width: text.length * style.fontSize * .6, ascent: style.fontSize, descent: style.fontSize * .25 });
const layout = (pkg, bestEffort = false, metrics = measure) => layoutDocument(pkg.paragraphs, metrics, pageGeometry(pkg.pageSettings), pkg.numbering, pkg.tables, pkg.pageStories, { bestEffort });
const geometry = l => ({ pages: l.pageCount, lines: l.lines.map(line => ({ page: line.page, column: line.column, x: line.x, y: line.y, baseline: line.baseline, height: line.height,
  fragments: line.fragments.map(f => ({ text: f.text, x: f.x, width: f.width })) })), cells: l.cells.map(cell => ({ page: cell.page, x: cell.x, y: cell.y, width: cell.width, height: cell.height })) });

it.each(['columns-center', 'columns-bottom', 'columns-both', 'columns-combined', 'continuous-center'])('approximates only unsupported section alignment without flattening content: %s', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes, { bestEffort: true });
  const control = await DocxPackage.open(source(name.startsWith('columns') ? 'columns-top' : 'continuous-top'));
  const before = JSON.stringify({ paragraphs: pkg.paragraphs, settings: pkg.pageSettings, tables: pkg.tables });
  expect(() => layout(pkg)).toThrow('Vertical page alignment with columns or continuous sections');
  const recovered = layout(pkg, true), expected = layout(control);
  expect(geometry(recovered)).toEqual(geometry(expected));
  expect(recovered.pageCount).toBe(2);
  expect(recovered.pages.map(p => p.verticalAlignment)).toEqual(['top', 'center']);
  expect(recovered.alignmentApproximations.map(a => a.section)).toEqual(name.startsWith('columns') ? [0] : [0, 1]);
  expect(recovered.alignmentApproximations.every(a => a.message.includes('shown at the top'))).toBe(true);
  expect(pkg.tables).toHaveLength(1); expect(Object.keys(pkg.assets)).toHaveLength(2);
  expect(Object.keys(pkg.pageStories.stories)).toEqual(['word/header1.xml']);
  expect(JSON.stringify({ paragraphs: pkg.paragraphs, settings: pkg.pageSettings, tables: pkg.tables })).toBe(before);
  const original = unzipSync(bytes);
  for (const part of Object.keys(original)) expect(Buffer.from(pkg.parts[part]).equals(Buffer.from(original[part])), part).toBe(true);
  expect(() => layout(pkg, true, () => { throw new Error('measurement failure'); })).toThrow('measurement failure');
});

it.each(['columns-top', 'continuous-top'])('keeps supported section alignment editable: %s', async name => {
  const bytes = source(name), pkg = await DocxPackage.open(bytes);
  expect(pkg.readOnly).not.toBe(true);
  expect(layout(pkg).alignmentApproximations).toBeUndefined();
  const original = unzipSync(bytes), exported = unzipSync(new Uint8Array(await pkg.export().arrayBuffer()));
  for (const part of Object.keys(original)) expect(Buffer.from(exported[part]).equals(Buffer.from(original[part])), part).toBe(true);
});
